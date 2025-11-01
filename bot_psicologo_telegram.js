// Proyecto: Psicólogo virtual para Telegram (alojado en Vercel)

// ========================
// 1. Crear el bot en Telegram
// ========================
// 1.1. Abre Telegram y busca "@BotFather"
// 1.2. Ejecuta /newbot y sigue los pasos para nombrarlo (ej. PatriPsicobot)
// 1.3. Copia el TOKEN que te entrega (lo usarás en el código)

// ========================
// 2. Crear el backend en Vercel (Node.js + Express + OpenAI)
// ========================

// archivo: index.js
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// ========================
// 3. Webhook de Telegram
// ========================
app.post("/webhook", async (req, res) => {
  const msg = req.body.message;
  const chatId = msg.chat.id;
  const userText = msg.text;

  // 1. Recuperar historial previo (si quieres memoria)
  const history = await getHistory(chatId);

  // 2. Generar respuesta con OpenAI
  const response = await generateResponse(userText, history);

  // 3. Enviar respuesta a Telegram
  await axios.post(`${TELEGRAM_URL}/sendMessage`, {
    chat_id: chatId,
    text: response,
  });

  // 4. Guardar mensaje en historial
  await saveMessage(chatId, userText, response);

  res.sendStatus(200);
});

// ========================
// 4. Función: generar respuesta con OpenAI
// ========================
async function generateResponse(message, history) {
  const prompt = `Actúa como un psicólogo virtual amable y cercano. Este es el historial previo: ${history}\nUsuario: ${message}\nPsicólogo:`;

  const completion = await axios.post(
    "https://api.openai.com/v1/completions",
    {
      model: "text-davinci-003",
      prompt,
      max_tokens: 150,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
    }
  );

  return completion.data.choices[0].text.trim();
}

// ========================
// 5. Funciones: guardar y recuperar historial
// ========================
async function saveMessage(chatId, userText, botResponse) {
  // Aquí puedes guardar el historial en Supabase
  // Ejemplo: fetch a Supabase REST API para insertar mensaje
}

async function getHistory(chatId) {
  // Aquí puedes consultar los últimos 5 mensajes previos de este usuario desde Supabase
  // Devuelve una string combinada estilo conversación
  return ""; // Por ahora vacío si no implementas Supabase
}

// ========================
// 6. Desplegar en Vercel
// ========================
// 1. Sube este proyecto a GitHub
// 2. Conecta el repo a Vercel
// 3. Añade estas variables de entorno:
//    - TELEGRAM_TOKEN
//    - OPENAI_API_KEY
//    - SUPABASE_URL
//    - SUPABASE_KEY (opcional si usas Supabase REST API)
// 4. Pon el webhook así:
//    curl https://api.telegram.org/bot<TELEGRAM_TOKEN>/setWebhook?url=https://<tu-url-vercel>/webhook

// ========================
// 7. Extras
// ========================
// - Puedes crear un dashboard para ver mensajes y editar el prompt desde Supabase o un panel privado en Vercel.
// - Puedes hacer que el bot firme como "Tu psicólogo virtual 💬" al final de cada respuesta.

// Fin del setup inicial
