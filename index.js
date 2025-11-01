// Bot Psicólogo Virtual para Telegram
// Alojado en Vercel con OpenAI GPT

const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();

// Middleware
app.use(express.json());

// Variables de entorno
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Validar variables de entorno
if (!TELEGRAM_TOKEN || !OPENAI_API_KEY) {
  console.error("❌ ERROR: Faltan variables de entorno requeridas (TELEGRAM_TOKEN, OPENAI_API_KEY)");
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
// Webhook de Telegram
// ========================
app.post("/webhook", async (req, res) => {
  try {
    // Validar que existe el mensaje
    const msg = req.body.message;
    if (!msg) {
      return res.sendStatus(200); // Telegram espera 200 incluso si ignoramos el update
    }

    const chatId = msg.chat.id;
    const userText = msg.text;

    // Ignorar comandos del bot (como /start) o mensajes sin texto
    if (!userText || userText.startsWith("/")) {
      // Responder a /start
      if (userText === "/start") {
        await sendTelegramMessage(
          chatId,
          "👋 Hola, soy tu psicólogo virtual. Estoy aquí para escucharte y ayudarte. ¿En qué puedo ayudarte hoy?"
        );
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

    // 2. Generar respuesta con OpenAI
    const response = await generateResponse(userText, history);

    // 3. Enviar respuesta a Telegram
    await sendTelegramMessage(chatId, response);

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
    await axios.post(`${TELEGRAM_URL}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: "Markdown", // Soporte para formato básico
    });
  } catch (error) {
    console.error("Error al enviar mensaje a Telegram:", error.response?.data || error.message);
    throw error;
  }
}

// ========================
// Función: Generar respuesta con OpenAI
// ========================
async function generateResponse(message, history) {
  try {
    // Construir el prompt con historial
    const systemPrompt = `Eres un psicólogo virtual amable, empático y profesional. 
Escuchas atentamente, haces preguntas reflexivas y ofreces apoyo emocional. 
Mantén tus respuestas concisas (máximo 200 palabras) pero cálidas.`;

    const messages = [
      { role: "system", content: systemPrompt },
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
        model: "gpt-3.5-turbo",
        messages: messages,
        max_tokens: 300,
        temperature: 0.7,
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
    response += "\n\n💬 *Tu psicólogo virtual*";

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

