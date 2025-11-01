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

// Endpoint de prueba para verificar rutas
app.get("/test-admin", (req, res) => {
  res.json({ message: "Las rutas funcionan", timestamp: new Date().toISOString() });
});

// ========================
// Panel de Administración
// HTML incrustado directamente para evitar problemas de archivos
// ========================
const adminHTML = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Panel de Administración - Bot Psicólogo Virtual</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 { font-size: 2.5em; margin-bottom: 10px; }
        .content { padding: 40px; }
        .login-container {
            max-width: 400px;
            margin: 100px auto;
            text-align: center;
        }
        .login-container input {
            width: 100%;
            padding: 15px;
            margin: 10px 0;
            border: 2px solid #ddd;
            border-radius: 10px;
            font-size: 16px;
        }
        .btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 10px;
            font-size: 16px;
            cursor: pointer;
            transition: transform 0.2s;
            width: 100%;
            margin-top: 10px;
        }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4); }
        .btn:active { transform: translateY(0); }
        .section {
            margin-bottom: 40px;
            padding: 30px;
            background: #f8f9fa;
            border-radius: 15px;
        }
        .section h2 { color: #333; margin-bottom: 20px; font-size: 1.8em; }
        .form-group { margin-bottom: 20px; }
        .form-group label {
            display: block;
            margin-bottom: 8px;
            color: #555;
            font-weight: 600;
        }
        .form-group textarea {
            width: 100%;
            padding: 12px;
            border: 2px solid #ddd;
            border-radius: 10px;
            font-size: 14px;
            font-family: inherit;
            resize: vertical;
            min-height: 150px;
        }
        .form-group input, .form-group select {
            width: 100%;
            padding: 12px;
            border: 2px solid #ddd;
            border-radius: 10px;
            font-size: 14px;
        }
        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }
        .alert {
            padding: 15px;
            border-radius: 10px;
            margin-bottom: 20px;
            display: none;
        }
        .alert.success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .alert.error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .alert.show { display: block; }
        .document-list { margin-top: 20px; }
        .document-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px;
            background: white;
            border-radius: 10px;
            margin-bottom: 10px;
            border: 1px solid #ddd;
        }
        .document-item a {
            color: #667eea;
            text-decoration: none;
            flex: 1;
        }
        .document-item a:hover { text-decoration: underline; }
        .btn-danger { background: #dc3545; padding: 8px 15px; font-size: 14px; }
        .file-upload {
            border: 2px dashed #ddd;
            border-radius: 10px;
            padding: 30px;
            text-align: center;
            cursor: pointer;
            transition: all 0.3s;
        }
        .file-upload:hover { border-color: #667eea; background: #f8f9fa; }
        .file-upload input { display: none; }
        .hidden { display: none; }
        .loading { text-align: center; padding: 20px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 Panel de Administración</h1>
            <p>Gestiona tu Bot Psicólogo Virtual</p>
        </div>
        <div id="loginContainer" class="content">
            <div class="login-container">
                <h2>Iniciar Sesión</h2>
                <input type="password" id="passwordInput" placeholder="Contraseña" />
                <button class="btn" onclick="login()">Entrar</button>
                <div id="loginAlert" class="alert"></div>
            </div>
        </div>
        <div id="mainPanel" class="content hidden">
            <div id="alert" class="alert"></div>
            <div class="section">
                <h2>⚙️ Configuración del Bot</h2>
                <div class="form-group">
                    <label>Prompt del Sistema (Instrucciones para el psicólogo)</label>
                    <textarea id="systemPrompt" placeholder="Eres un psicólogo virtual..."></textarea>
                </div>
                <div class="form-group">
                    <label>Mensaje de Bienvenida</label>
                    <textarea id="welcomeMessage" placeholder="👋 Hola, soy tu psicólogo virtual..."></textarea>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Modelo de OpenAI</label>
                        <select id="model">
                            <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                            <option value="gpt-4">GPT-4</option>
                            <option value="gpt-4-turbo">GPT-4 Turbo</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Máximo de Tokens</label>
                        <input type="number" id="maxTokens" value="300" min="50" max="2000" />
                    </div>
                </div>
                <div class="form-group">
                    <label>Temperatura (0-2)</label>
                    <input type="number" id="temperature" value="0.7" min="0" max="2" step="0.1" />
                    <small style="color: #666;">Valores más altos = respuestas más creativas</small>
                </div>
                <button class="btn" onclick="saveConfig()">💾 Guardar Configuración</button>
            </div>
            <div class="section">
                <h2>📄 Documentos</h2>
                <div class="file-upload" onclick="document.getElementById('fileInput').click()">
                    <p>📁 Click para subir un documento</p>
                    <p style="color: #666; font-size: 12px; margin-top: 10px;">PDF, DOCX, TXT, etc.</p>
                    <input type="file" id="fileInput" onchange="uploadFile()" />
                </div>
                <div id="documentsList" class="document-list">
                    <div class="loading">Cargando documentos...</div>
                </div>
            </div>
        </div>
    </div>
    <script>
        let authToken = localStorage.getItem('adminToken');
        if (authToken) checkAuth();
        async function checkAuth() {
            try {
                const response = await fetch('/api/config', {
                    headers: { 'Authorization': \`Bearer \${authToken}\` }
                });
                if (response.ok) {
                    showMainPanel();
                    loadConfig();
                    loadDocuments();
                } else {
                    localStorage.removeItem('adminToken');
                }
            } catch (e) { console.error(e); }
        }
        async function login() {
            const password = document.getElementById('passwordInput').value;
            if (!password) {
                showAlert('loginAlert', 'Por favor ingresa la contraseña', 'error');
                return;
            }
            try {
                const response = await fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });
                const data = await response.json();
                if (response.ok) {
                    authToken = data.token;
                    localStorage.setItem('adminToken', authToken);
                    showMainPanel();
                    loadConfig();
                    loadDocuments();
                } else {
                    showAlert('loginAlert', data.error || 'Contraseña incorrecta', 'error');
                }
            } catch (e) {
                showAlert('loginAlert', 'Error al conectar con el servidor', 'error');
            }
        }
        function showMainPanel() {
            document.getElementById('loginContainer').classList.add('hidden');
            document.getElementById('mainPanel').classList.remove('hidden');
        }
        async function loadConfig() {
            try {
                const response = await fetch('/api/config', {
                    headers: { 'Authorization': \`Bearer \${authToken}\` }
                });
                const config = await response.json();
                document.getElementById('systemPrompt').value = config.systemPrompt || '';
                document.getElementById('welcomeMessage').value = config.welcomeMessage || '';
                document.getElementById('model').value = config.model || 'gpt-3.5-turbo';
                document.getElementById('maxTokens').value = config.maxTokens || 300;
                document.getElementById('temperature').value = config.temperature || 0.7;
            } catch (e) {
                showAlert('alert', 'Error al cargar configuración', 'error');
            }
        }
        async function saveConfig() {
            const config = {
                systemPrompt: document.getElementById('systemPrompt').value,
                welcomeMessage: document.getElementById('welcomeMessage').value,
                model: document.getElementById('model').value,
                maxTokens: parseInt(document.getElementById('maxTokens').value),
                temperature: parseFloat(document.getElementById('temperature').value)
            };
            try {
                const response = await fetch('/api/config', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': \`Bearer \${authToken}\`
                    },
                    body: JSON.stringify(config)
                });
                const data = await response.json();
                if (response.ok) {
                    showAlert('alert', '✅ Configuración guardada exitosamente', 'success');
                } else {
                    showAlert('alert', data.error || 'Error al guardar', 'error');
                }
            } catch (e) {
                showAlert('alert', 'Error al guardar configuración', 'error');
            }
        }
        async function loadDocuments() {
            try {
                const response = await fetch('/api/documents', {
                    headers: { 'Authorization': \`Bearer \${authToken}\` }
                });
                const data = await response.json();
                const container = document.getElementById('documentsList');
                if (data.documents && data.documents.length > 0) {
                    container.innerHTML = data.documents.map(doc => \`
                        <div class="document-item">
                            <a href="\${doc.url}" target="_blank">\${doc.pathname}</a>
                            <button class="btn btn-danger" onclick="deleteDocument('\${doc.pathname}')">Eliminar</button>
                        </div>
                    \`).join('');
                } else {
                    container.innerHTML = '<p style="text-align: center; color: #666;">No hay documentos subidos</p>';
                }
            } catch (e) {
                document.getElementById('documentsList').innerHTML = 
                    '<p style="text-align: center; color: #dc3545;">Error al cargar documentos</p>';
            }
        }
        async function uploadFile() {
            const fileInput = document.getElementById('fileInput');
            const file = fileInput.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async function(e) {
                const base64 = e.target.result.split(',')[1];
                try {
                    const response = await fetch('/api/documents', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': \`Bearer \${authToken}\`
                        },
                        body: JSON.stringify({
                            filename: file.name,
                            content: base64,
                            contentType: file.type
                        })
                    });
                    const data = await response.json();
                    if (response.ok) {
                        showAlert('alert', '✅ Documento subido exitosamente', 'success');
                        loadDocuments();
                        fileInput.value = '';
                    } else {
                        showAlert('alert', data.error || 'Error al subir documento', 'error');
                    }
                } catch (e) {
                    showAlert('alert', 'Error al subir documento', 'error');
                }
            };
            reader.readAsDataURL(file);
        }
        async function deleteDocument(pathname) {
            if (!confirm('¿Estás seguro de eliminar este documento?')) return;
            const filename = pathname.split('/').pop();
            try {
                const response = await fetch(\`/api/documents/\${filename}\`, {
                    method: 'DELETE',
                    headers: { 'Authorization': \`Bearer \${authToken}\` }
                });
                if (response.ok) {
                    showAlert('alert', '✅ Documento eliminado', 'success');
                    loadDocuments();
                } else {
                    showAlert('alert', 'Error al eliminar documento', 'error');
                }
            } catch (e) {
                showAlert('alert', 'Error al eliminar documento', 'error');
            }
        }
        function showAlert(id, message, type) {
            const alert = document.getElementById(id);
            alert.textContent = message;
            alert.className = \`alert \${type} show\`;
            setTimeout(() => { alert.classList.remove('show'); }, 5000);
        }
        document.getElementById('passwordInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') login();
        });
    </script>
</body>
</html>`;

// Registrar la ruta /admin - debe estar ANTES de express.static
app.get("/admin", (req, res) => {
  try {
    console.log("📥 Petición GET /admin recibida");
    console.log("✅ Serviendo panel admin");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(adminHTML);
  } catch (error) {
    console.error("❌ Error al servir /admin:", error);
    res.status(500).send(`<h1>Error</h1><p>${error.message}</p>`);
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

