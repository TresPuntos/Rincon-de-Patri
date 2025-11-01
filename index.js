// Bot Psicólogo Virtual para Telegram
// Alojado en Vercel con OpenAI GPT

const express = require("express");
const axios = require("axios");
const path = require("path");
require("dotenv").config();

// Intentar importar Vercel KV y Blob (opcionales)
let kv = null;
let put = null;
let del = null;
let list = null;
try {
  const { kv: kvClient } = require("@vercel/kv");
  kv = kvClient;
} catch (e) {
  console.warn("⚠️ Vercel KV no disponible, usando almacenamiento en memoria");
}

try {
  const { put: putBlob, del: delBlob, list: listBlobs } = require("@vercel/blob");
  put = putBlob;
  del = delBlob;
  list = listBlobs;
} catch (e) {
  console.warn("⚠️ Vercel Blob no disponible para almacenar documentos");
}

const app = express();

// Variables de entorno
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123"; // Cambia esto en producción

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Validar variables de entorno
if (!TELEGRAM_TOKEN || !OPENAI_API_KEY) {
  console.error("❌ ERROR: Faltan variables de entorno requeridas (TELEGRAM_TOKEN, OPENAI_API_KEY)");
  console.error("TELEGRAM_TOKEN:", TELEGRAM_TOKEN ? "✓ Configurado" : "✗ FALTA");
  console.error("OPENAI_API_KEY:", OPENAI_API_KEY ? "✓ Configurado" : "✗ FALTA");
} else {
  // Validar formato de las keys
  if (!TELEGRAM_TOKEN.includes(":")) {
    console.error("⚠️ ADVERTENCIA: TELEGRAM_TOKEN parece tener formato incorrecto (debe contener ':')");
  }
  if (!OPENAI_API_KEY.startsWith("sk-")) {
    console.error("⚠️ ADVERTENCIA: OPENAI_API_KEY parece tener formato incorrecto (debe comenzar con 'sk-')");
    console.error("Primeros caracteres:", OPENAI_API_KEY.substring(0, 10) + "...");
  }
}

// ========================
// Almacenamiento en memoria (historial de conversaciones)
// ========================
// NOTA: Este almacenamiento se reinicia cuando Vercel hace un nuevo deploy.
// Para persistencia permanente, considera usar Vercel KV (Redis):
// https://vercel.com/docs/storage/vercel-kv
const conversationHistory = new Map(); // chatId -> array de mensajes

// Máximo de mensajes a mantener por conversación (para no exceder límites de tokens)
const MAX_HISTORY_MESSAGES = 10;

// ========================
// Health Check
// ========================
app.get("/", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "Bot Psicólogo Virtual está funcionando",
    timestamp: new Date().toISOString()
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

// ========================
// Panel de Administración (debe ir ANTES de express.static)
// ========================
const fs = require("fs");
app.get("/admin", (req, res) => {
  try {
    // Intentar diferentes rutas según el entorno
    const possiblePaths = [
      path.join(__dirname, "public", "admin.html"),
      path.join(process.cwd(), "public", "admin.html"),
      path.join(__dirname, "admin.html"),
      "public/admin.html",
      "./public/admin.html"
    ];
    
    let adminContent = null;
    for (const p of possiblePaths) {
      try {
        if (fs.existsSync(p)) {
          adminContent = fs.readFileSync(p, "utf8");
          console.log(`✅ Panel admin cargado desde: ${p}`);
          break;
        }
      } catch (e) {
        // Continuar con la siguiente ruta
      }
    }
    
    if (adminContent) {
      res.setHeader("Content-Type", "text/html");
      res.send(adminContent);
    } else {
      console.error("❌ No se encontró admin.html en ninguna ruta:", possiblePaths);
      res.status(404).send(`
        <html>
          <body>
            <h1>Panel no encontrado</h1>
            <p>Rutas intentadas: ${possiblePaths.join(", ")}</p>
            <p>__dirname: ${__dirname}</p>
            <p>process.cwd(): ${process.cwd()}</p>
          </body>
        </html>
      `);
    }
  } catch (error) {
    console.error("❌ Error al servir admin.html:", error);
    res.status(500).send(`Error al cargar el panel: ${error.message}`);
  }
});

// Servir archivos estáticos (después de rutas específicas)
app.use(express.static("public"));

// ========================
// Autenticación del Panel
// ========================
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

// ========================
// API: Configuración del Bot
// ========================
async function getBotConfig() {
  try {
    if (kv) {
      const config = await kv.get("bot:config");
      if (config) return config;
    }
    // Si no hay KV, usar variable global (si existe)
    if (global.botConfig) {
      return global.botConfig;
    }
    // Configuración por defecto
    return {
      systemPrompt: `Eres un psicólogo virtual amable, empático y profesional. 
Escuchas atentamente, haces preguntas reflexivas y ofreces apoyo emocional. 
Mantén tus respuestas concisas (máximo 200 palabras) pero cálidas.`,
      model: "gpt-3.5-turbo",
      maxTokens: 300,
      temperature: 0.7,
      welcomeMessage: "👋 Hola, soy tu psicólogo virtual. Estoy aquí para escucharte y ayudarte. ¿En qué puedo ayudarte hoy?"
    };
  } catch (error) {
    console.error("Error al obtener configuración:", error);
    throw error;
  }
}

async function saveBotConfig(config) {
  try {
    if (kv) {
      await kv.set("bot:config", config);
      return true;
    }
    // Si no hay KV, usar variable global (solo en memoria)
    global.botConfig = config;
    return true;
  } catch (error) {
    console.error("Error al guardar configuración:", error);
    throw error;
  }
}

app.get("/api/config", requireAuth, async (req, res) => {
  try {
    const config = await getBotConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/config", requireAuth, async (req, res) => {
  try {
    const config = {
      systemPrompt: req.body.systemPrompt || "",
      model: req.body.model || "gpt-3.5-turbo",
      maxTokens: parseInt(req.body.maxTokens) || 300,
      temperature: parseFloat(req.body.temperature) || 0.7,
      welcomeMessage: req.body.welcomeMessage || ""
    };
    await saveBotConfig(config);
    res.json({ success: true, config });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================
// API: Documentos
// ========================
app.get("/api/documents", requireAuth, async (req, res) => {
  try {
    if (!list) {
      return res.json({ documents: [] });
    }
    const { blobs } = await list({ prefix: "documents/" });
    const documents = blobs.map(blob => ({
      url: blob.url,
      pathname: blob.pathname,
      size: blob.size,
      uploadedAt: blob.uploadedAt
    }));
    res.json({ documents });
  } catch (error) {
    console.error("Error al listar documentos:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/documents", requireAuth, async (req, res) => {
  try {
    if (!put) {
      return res.status(503).json({ error: "Vercel Blob Storage no está configurado" });
    }

    // Para subir archivos, necesitamos usar multipart/form-data
    // Por simplicidad, aceptamos archivos base64 o URLs
    const { filename, content, contentType } = req.body;
    
    if (!filename || !content) {
      return res.status(400).json({ error: "Se requiere filename y content" });
    }

    const buffer = Buffer.from(content, 'base64');
    const blob = await put(`documents/${filename}`, buffer, {
      access: 'public',
      contentType: contentType || 'application/octet-stream'
    });

    res.json({ success: true, url: blob.url });
  } catch (error) {
    console.error("Error al subir documento:", error);
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/documents/:path", requireAuth, async (req, res) => {
  try {
    if (!del) {
      return res.status(503).json({ error: "Vercel Blob Storage no está configurado" });
    }
    
    const pathname = `documents/${req.params.path}`;
    await del(pathname);
    res.json({ success: true });
  } catch (error) {
    console.error("Error al eliminar documento:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para autenticación
app.post("/api/auth", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ token: ADMIN_PASSWORD });
  } else {
    res.status(401).json({ error: "Contraseña incorrecta" });
  }
});

// ========================
// Webhook de Telegram
// ========================
app.post("/webhook", async (req, res) => {
  try {
    console.log("📨 Webhook recibido:", JSON.stringify(req.body).substring(0, 200));
    
    // Validar que existe el mensaje
    const msg = req.body.message;
    if (!msg) {
      console.log("⚠️ No hay mensaje en el body");
      return res.sendStatus(200); // Telegram espera 200 incluso si ignoramos el update
    }

    const chatId = msg.chat.id;
    const userText = msg.text;
    
    console.log(`💬 Mensaje recibido de chat ${chatId}: ${userText?.substring(0, 50)}`);

    // Ignorar comandos del bot (como /start) o mensajes sin texto
    if (!userText || userText.startsWith("/")) {
      // Responder a /start
      if (userText === "/start") {
        console.log("🚀 Comando /start recibido");
        const config = await getBotConfig();
        const welcomeMsg = config.welcomeMessage || "👋 Hola, soy tu psicólogo virtual. Estoy aquí para escucharte y ayudarte. ¿En qué puedo ayudarte hoy?";
        await sendTelegramMessage(chatId, welcomeMsg);
      } else {
        console.log("⚠️ Mensaje ignorado (sin texto o comando no reconocido)");
      }
      return res.sendStatus(200);
    }

    // Mostrar "escribiendo..." en Telegram
    await axios.post(`${TELEGRAM_URL}/sendChatAction`, {
      chat_id: chatId,
      action: "typing",
    });

    // 1. Recuperar historial previo
    const history = getHistory(chatId);
    console.log(`📚 Historial recuperado: ${history.length} mensajes`);

    // 2. Generar respuesta con OpenAI
    console.log("🤖 Generando respuesta con OpenAI...");
    const response = await generateResponse(userText, history);
    console.log(`✅ Respuesta generada: ${response.substring(0, 50)}...`);

    // 3. Enviar respuesta a Telegram
    console.log("📤 Enviando respuesta a Telegram...");
    await sendTelegramMessage(chatId, response);
    console.log("✅ Respuesta enviada exitosamente");

    // 4. Guardar mensaje en historial
    saveMessage(chatId, userText, response);

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Error en webhook:", error);
    
    // Intentar enviar mensaje de error al usuario
    try {
      const chatId = req.body.message?.chat?.id;
      if (chatId) {
        await sendTelegramMessage(
          chatId,
          "⚠️ Lo siento, hubo un error al procesar tu mensaje. Por favor, intenta de nuevo."
        );
      }
    } catch (err) {
      console.error("Error al enviar mensaje de error:", err);
    }
    
    res.sendStatus(200); // Siempre responder 200 a Telegram
  }
});

// ========================
// Función: Enviar mensaje a Telegram
// ========================
async function sendTelegramMessage(chatId, text) {
  try {
    // Limpiar formato Markdown problemático
    const cleanText = text.replace(/\*+/g, ''); // Remover asteriscos problemáticos
    
    const response = await axios.post(`${TELEGRAM_URL}/sendMessage`, {
      chat_id: chatId,
      text: cleanText,
    });
    
    console.log(`✅ Mensaje enviado a Telegram (chatId: ${chatId})`);
    return response.data;
  } catch (error) {
    console.error("❌ Error al enviar mensaje a Telegram:");
    console.error("Chat ID:", chatId);
    console.error("Error:", error.response?.data || error.message);
    console.error("Status:", error.response?.status);
    throw error;
  }
}

// ========================
// Función: Generar respuesta con OpenAI
// ========================
async function generateResponse(message, history) {
  try {
    // Obtener configuración del bot (desde KV o memoria)
    const config = await getBotConfig();
    
    const messages = [
      { role: "system", content: config.systemPrompt },
    ];

    // Añadir historial si existe
    if (history && history.length > 0) {
      history.forEach((msg) => {
        messages.push({ role: "user", content: msg.user });
        messages.push({ role: "assistant", content: msg.bot });
      });
    }

    // Añadir el mensaje actual
    messages.push({ role: "user", content: message });

    // Llamar a la API de OpenAI (Chat Completions)
    const completion = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: config.model,
        messages: messages,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    let response = completion.data.choices[0].message.content.trim();

    // Añadir firma al final (opcional)
    response += "\n\n💬 Tu psicólogo virtual";

    return response;
  } catch (error) {
    console.error("Error al generar respuesta con OpenAI:", error.response?.data || error.message);
    
    // Si es error de API, devolver mensaje genérico
    if (error.response?.status === 401) {
      throw new Error("API Key de OpenAI inválida");
    } else if (error.response?.status === 429) {
      throw new Error("Límite de tasa de OpenAI excedido");
    }
    
    throw error;
  }
}

// ========================
// Funciones: Guardar y recuperar historial
// ========================
function saveMessage(chatId, userText, botResponse) {
  try {
    if (!conversationHistory.has(chatId)) {
      conversationHistory.set(chatId, []);
    }

    const messages = conversationHistory.get(chatId);
    messages.push({
      user: userText,
      bot: botResponse,
      timestamp: new Date().toISOString(),
    });

    // Mantener solo los últimos N mensajes
    if (messages.length > MAX_HISTORY_MESSAGES) {
      messages.shift(); // Eliminar el más antiguo
    }

    conversationHistory.set(chatId, messages);
  } catch (error) {
    console.error("Error al guardar mensaje en historial:", error);
  }
}

function getHistory(chatId) {
  try {
    return conversationHistory.get(chatId) || [];
  } catch (error) {
    console.error("Error al recuperar historial:", error);
    return [];
  }
}

// ========================
// Exportar para Vercel
// ========================
module.exports = app;

// Para desarrollo local (opcional)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🤖 Bot corriendo en http://localhost:${PORT}`);
  });
}

