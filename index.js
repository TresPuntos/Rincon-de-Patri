// Bot Psicólogo Virtual para Telegram
// Alojado en Vercel con OpenAI GPT
// Version 2.2 - Con sistema completo de memoria

const express = require("express");
const axios = require("axios");
const path = require("path");
const fs = require("fs");

// Cargar pdf-parse de forma opcional para evitar errores en Vercel
let pdf = null;
try {
  pdf = require("pdf-parse");
} catch (e) {
  console.warn("⚠️ pdf-parse no disponible, los PDFs no se podrán cargar");
}

// dotenv solo en desarrollo
if (!process.env.VERCEL) {
  try {
    require("dotenv").config();
  } catch (e) {
    console.warn("⚠️ dotenv no disponible");
  }
}

// Intentar importar Vercel KV y Blob (opcionales)
let kv = null;
let put = null;
let del = null;
let list = null;
try {
  // Verificar que las variables de entorno estén configuradas antes de inicializar
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const { kv: kvClient } = require("@vercel/kv");
    kv = kvClient;
    console.log("✅ Vercel KV inicializado correctamente");
  } else {
    console.warn("⚠️ Vercel KV no configurado (faltan variables KV_REST_API_URL o KV_REST_API_TOKEN), usando almacenamiento en memoria");
    console.warn("   La configuración se guardará en memoria y se perderá al reiniciar el servidor");
  }
} catch (e) {
  console.warn("⚠️ Vercel KV no disponible, usando almacenamiento en memoria:", e.message);
}

try {
  // Verificar que las variables de entorno estén configuradas antes de inicializar
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put: putBlob, del: delBlob, list: listBlobs } = require("@vercel/blob");
    put = putBlob;
    del = delBlob;
    list = listBlobs;
    console.log("✅ Vercel Blob inicializado correctamente");
  } else {
    console.warn("⚠️ Vercel Blob no configurado (falta variable BLOB_READ_WRITE_TOKEN), no se podrán subir documentos");
  }
} catch (e) {
  console.warn("⚠️ Vercel Blob no disponible, no se podrán subir documentos:", e.message);
}

const app = express();

// Variables de entorno
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_URL = TELEGRAM_TOKEN ? `https://api.telegram.org/bot${TELEGRAM_TOKEN}` : null;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123"; // Cambia esto en producción

// Validación más suave para evitar crashes en Vercel
if (!TELEGRAM_TOKEN || !OPENAI_API_KEY) {
  console.warn("⚠️ ADVERTENCIA: Variables de entorno no configuradas completamente");
  console.warn("TELEGRAM_TOKEN:", TELEGRAM_TOKEN ? "✓" : "✗");
  console.warn("OPENAI_API_KEY:", OPENAI_API_KEY ? "✓" : "✗");
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Validar formato de las keys (solo si están presentes)
if (TELEGRAM_TOKEN && !TELEGRAM_TOKEN.includes(":")) {
  console.warn("⚠️ ADVERTENCIA: TELEGRAM_TOKEN parece tener formato incorrecto (debe contener ':')");
}
if (OPENAI_API_KEY && !OPENAI_API_KEY.startsWith("sk-")) {
  console.warn("⚠️ ADVERTENCIA: OPENAI_API_KEY parece tener formato incorrecto (debe comenzar con 'sk-')");
  if (OPENAI_API_KEY.length > 10) {
    console.warn("Primeros caracteres:", OPENAI_API_KEY.substring(0, 10) + "...");
  }
}

// ========================
// Almacenamiento de conversaciones con memoria persistente
// ========================
// NOTA: Este almacenamiento se reinicia cuando Vercel hace un nuevo deploy.
// Para persistencia permanente, considera usar Vercel KV (Redis):
// https://vercel.com/docs/storage/vercel-kv
const conversationHistory = new Map(); // chatId -> array de mensajes
const conversationSummaries = new Map(); // chatId -> array de resúmenes por categoría
const lastSummaryCount = new Map(); // chatId -> número de mensajes cuando se hizo el último resumen
const clinicalHistory = new Map(); // chatId -> historial clínico completo (como un psicólogo real)

// Máximo de mensajes a mantener por conversación (para no exceder límites de tokens)
const MAX_HISTORY_MESSAGES = 50; // Aumentado para mantener más contexto
const MAX_SUMMARY_MESSAGES = 10; // Después de cuántos mensajes generar resumen (reducido para generar más frecuentemente)
const MAX_SUMMARIES_PER_CATEGORY = 5; // Máximo de resúmenes por categoría
const CLINICAL_NOTES_INTERVAL = 10; // Generar nota clínica cada N mensajes (reducido de 20 a 10 para generar más frecuentemente)

// Cargar contenido de los PDFs de instrucciones (una vez al iniciar)
let instructionDocs = "";
async function loadInstructionDocs() {
  try {
    // En Vercel serverless, el sistema de archivos puede ser limitado
    // Intentar cargar PDFs pero no fallar si no están disponibles
    if (process.env.VERCEL && !process.env.ALLOW_PDF_LOAD) {
      console.log("⚠️ Modo Vercel: Saltando carga de PDFs (pueden no estar disponibles)");
      instructionDocs = "";
      return;
    }
    
    console.log("🔄 Iniciando carga de documentos de instrucciones...");
    console.log(`📂 Directorio actual: ${process.cwd()}`);
    console.log(`📂 __dirname: ${__dirname || 'no disponible'}`);
    
    const pdfFiles = [
      "Bot_Patri_Instrucciones/01_Instrucciones_Base.pdf",
      "Bot_Patri_Instrucciones/02_Personalidad.pdf",
      "Bot_Patri_Instrucciones/03_Conversaciones.pdf",
      "Bot_Patri_Instrucciones/04_Respuestas_Situaciones.pdf"
    ];
    
    const texts = [];
    let loadedCount = 0;
    
    for (const pdfPath of pdfFiles) {
      try {
        // Intentar diferentes rutas posibles en Vercel
        const possiblePaths = [
          path.join(__dirname, pdfPath),
          path.join(process.cwd(), pdfPath),
          path.join(process.cwd(), '..', pdfPath),
          pdfPath,
          path.join('/', pdfPath)
        ];
        
        let found = false;
        let foundPath = null;
        
        for (const p of possiblePaths) {
          try {
            if (fs.existsSync(p)) {
              foundPath = p;
              found = true;
              console.log(`✅ Encontrado en: ${p}`);
              break;
            }
          } catch (pathError) {
            // Continuar con el siguiente path
          }
        }
        
        if (found && foundPath) {
          try {
            if (!pdf) {
              console.warn(`⚠️ pdf-parse no disponible, saltando ${pdfPath}`);
              continue;
            }
            const dataBuffer = fs.readFileSync(foundPath);
            console.log(`📄 Leyendo PDF: ${foundPath} (${dataBuffer.length} bytes)`);
            const data = await pdf(dataBuffer);
            
            if (data && data.text && data.text.trim().length > 0) {
              texts.push(`\n=== ${path.basename(pdfPath)} ===\n${data.text}\n`);
              loadedCount++;
              console.log(`✅ PDF cargado correctamente: ${path.basename(pdfPath)} (${data.text.length} caracteres)`);
            } else {
              console.warn(`⚠️ PDF vacío o sin texto: ${path.basename(pdfPath)}`);
            }
          } catch (readError) {
            console.error(`❌ Error al leer el PDF ${foundPath}:`, readError.message);
            console.error(readError.stack);
          }
        } else {
          console.warn(`⚠️ PDF no encontrado en ninguna ruta: ${pdfPath}`);
          console.warn(`   Rutas probadas: ${possiblePaths.join(', ')}`);
        }
      } catch (error) {
        console.error(`❌ Error procesando ${pdfPath}:`, error.message);
        console.error(error.stack);
      }
    }
    
    instructionDocs = texts.join("\n");
    if (instructionDocs && instructionDocs.trim().length > 0) {
      console.log(`✅ Documentos de instrucciones cargados correctamente:`);
      console.log(`   - Archivos cargados: ${loadedCount}/${pdfFiles.length}`);
      console.log(`   - Total caracteres: ${instructionDocs.length}`);
      console.log(`   - Primeros caracteres: ${instructionDocs.substring(0, 200)}...`);
    } else {
      console.error("❌ ERROR CRÍTICO: Los documentos de instrucciones están vacíos o no se pudieron cargar");
      console.error("   El bot funcionará pero sin las instrucciones personalizadas de los PDFs");
    }
  } catch (error) {
    console.error("❌ Error crítico al cargar documentos de instrucciones:", error.message);
    console.error(error.stack);
  }
}

// Cargar documentos al iniciar (si están disponibles)
// En Vercel serverless, hacerlo de forma asíncrona y no bloquear
// Solo ejecutar si NO estamos en Vercel o si se permite explícitamente
if (!process.env.VERCEL || process.env.ALLOW_PDF_LOAD === 'true') {
  // Ejecutar de forma asíncrona sin bloquear
  setImmediate(() => {
    if (typeof loadInstructionDocs === 'function') {
      loadInstructionDocs().catch(err => {
        console.error("❌ Error al cargar documentos:", err.message || err);
        instructionDocs = "";
      });
    }
  });
} else {
  console.log("ℹ️ Modo Vercel: Saltando carga inicial de PDFs");
  instructionDocs = "";
}

// ========================
// Health Check
// ========================
app.get("/", (req, res) => {
  try {
    res.json({ 
      status: "ok", 
      message: "Bot Psicólogo Virtual está funcionando",
      version: "2.5-SERVERLESS",
      deployment: {
        vercel: !!process.env.VERCEL,
        handler: "api/index.js",
        environment: process.env.VERCEL_ENV || "production"
      },
      routes: {
        public: ["/", "/health", "/admin", "/historial"],
        api: ["/api/config", "/api/auth", "/api/documents"],
        webhook: "/webhook"
      },
      environment: {
        nodeVersion: process.version,
        vercel: !!process.env.VERCEL
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Error al generar respuesta",
      error: error.message,
      version: "2.5-ERROR",
      timestamp: new Date().toISOString()
    });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

// Endpoint de información (sin contraseña)
app.get("/info", (req, res) => {
  res.json({
    message: "Información del panel de administración",
    adminPanel: "https://rinconde-patri.vercel.app/admin",
    historialPanel: "https://rinconde-patri.vercel.app/historial",
    passwordInfo: {
      default: "admin123",
      configured: !!process.env.ADMIN_PASSWORD,
      hint: process.env.ADMIN_PASSWORD ? "Usando contraseña personalizada de Vercel" : "Usando contraseña por defecto: admin123"
    },
    howToGetChatId: [
      "Opción 1: Patri puede escribir /chatid o /id al bot y recibirá su Chat ID",
      "Opción 2: Revisa los logs de Vercel cuando Patri envíe un mensaje (verás 'Chat ID: ...')",
      "Opción 3: Ve a /admin y usa el endpoint de chat IDs activos"
    ],
    instructions: [
      "1. Ve a /admin o /historial",
      "2. Usa la contraseña mostrada arriba",
      "3. Para obtener el Chat ID, pide a Patri que escriba /chatid al bot",
      "4. Para cambiar la contraseña, añade ADMIN_PASSWORD en Vercel Settings → Environment Variables"
    ]
  });
});

// Endpoint para listar Chat IDs activos (requiere autenticación)
app.get("/api/chats", requireAuth, async (req, res) => {
  try {
    // Obtener todos los chat IDs que tienen historial
    const chatIds = Array.from(conversationHistory.keys());
    const chats = chatIds.map(id => {
      const history = conversationHistory.get(id);
      const lastMessage = history && history.length > 0 ? history[history.length - 1] : null;
      return {
        chatId: id,
        messageCount: history ? history.length : 0,
        lastActivity: lastMessage ? lastMessage.timestamp : null,
        hasClinicalHistory: clinicalHistory.has(id)
      };
    }).sort((a, b) => {
      // Ordenar por última actividad (más reciente primero)
      if (!a.lastActivity && !b.lastActivity) return 0;
      if (!a.lastActivity) return 1;
      if (!b.lastActivity) return -1;
      return new Date(b.lastActivity) - new Date(a.lastActivity);
    });
    
    res.json({
      totalChats: chats.length,
      chats: chats
    });
  } catch (error) {
    console.error("Error al obtener lista de chats:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para obtener el prompt completo que el bot usaría (requiere autenticación)
app.get("/api/current-prompt/:chatId?", requireAuth, async (req, res) => {
  try {
    const chatId = req.params.chatId || null;
    
    // Obtener configuración del bot
    const config = await getBotConfig();
    let systemPrompt = config.systemPrompt || "";
    
    // Cargar resúmenes si hay chatId
    let summariesText = "";
    let hasSummaries = false;
    if (chatId) {
      await loadSummariesFromKV(chatId);
      const summaries = getConversationSummaries(chatId);
      if (summaries && Object.keys(summaries).length > 0) {
        summariesText = formatSummariesForContext(summaries);
        systemPrompt += "\n\n" + summariesText + "\n\nUsa esta memoria de conversaciones anteriores para dar continuidad y personalizar tus respuestas. Referencia información relevante cuando sea apropiado.\n";
        hasSummaries = true;
      }
    }
    
    // Añadir documentación de instrucciones
    let hasInstructionDocs = false;
    let instructionDocsLength = 0;
    if (instructionDocs && instructionDocs.trim().length > 0) {
      instructionDocsLength = instructionDocs.length;
      systemPrompt += `\n\n⸻\n=== DOCUMENTACIÓN DISPONIBLE ===\n${instructionDocs}\n=== FIN DE LA DOCUMENTACIÓN ===\n\nIMPORTANTE: Revisa esta documentación antes de responder para entender mejor el contexto, la personalidad de Patri y las situaciones específicas que pueda estar viviendo. Usa esta información para personalizar tus respuestas. NO uses mensajes genéricos. Siempre personaliza según el contexto de Patri.\n`;
      hasInstructionDocs = true;
    }
    
    // Añadir instrucción final CRÍTICA
    systemPrompt += `\n\n⚠️⚠️⚠️ INSTRUCCIÓN FINAL CRÍTICA ⚠️⚠️⚠️\n\nNUNCA respondas con mensajes genéricos como saludos o preguntas vacías. SIEMPRE analiza el mensaje específico que Patri te envió y responde de forma directa, personalizada y relevante. Si no hay un mensaje de Patri que responder, no respondas con saludos genéricos.\n`;
    
    // Obtener historial de mensajes si hay chatId
    let historyLength = 0;
    if (chatId) {
      await loadHistoryFromKV(chatId);
      const history = getHistory(chatId);
      historyLength = history ? history.length : 0;
    }
    
    res.json({
      chatId: chatId || "base",
      fullPrompt: systemPrompt,
      length: systemPrompt.length,
      hasSummaries: hasSummaries,
      hasInstructionDocs: hasInstructionDocs,
      instructionDocsLength: instructionDocsLength,
      historyLength: historyLength,
      config: {
        model: config.model,
        maxTokens: config.maxTokens,
        temperature: config.temperature
      }
    });
  } catch (error) {
    console.error("Error al obtener prompt actual:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/patri", (req, res) => {
  res.json({ 
    message: "Acceso directo al historial de Patri",
    historial: "Disponible en /historial",
    admin: "Disponible en /admin"
  });
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
                <h2>🏥 Historial Clínico de Patri</h2>
                <div class="form-group">
                    <label>Chat ID</label>
                    <input type="text" id="chatIdInput" placeholder="Introduce el Chat ID de Telegram" />
                    <small style="color: #666;">Para obtener el Chat ID, envía un mensaje al bot y revisa los logs</small>
                </div>
                <button class="btn" onclick="viewClinicalHistory()">📋 Ver Historial Clínico</button>
                <button class="btn" onclick="downloadClinicalHistory()" style="background: #28a745; margin-top: 10px;">📥 Descargar como Markdown</button>
                <div id="clinicalHistoryContainer" style="margin-top: 30px; display: none;">
                    <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 10px; padding: 20px; margin-bottom: 20px;">
                        <h3>📋 Historial Clínico</h3>
                        <div id="clinicalHistoryContent" style="margin-top: 15px; white-space: pre-wrap; font-family: monospace; line-height: 1.6;"></div>
                    </div>
                </div>
            </div>
            <div class="section">
                <h2>🔍 Prompt Actual del Bot</h2>
                <div class="form-group">
                    <label>Chat ID (opcional - para ver prompt personalizado)</label>
                    <input type="text" id="promptChatIdInput" placeholder="Deja vacío para ver el prompt base" />
                    <small style="color: #666;">El prompt se personaliza según el Chat ID con resúmenes e historial</small>
                </div>
                <button class="btn" onclick="loadCurrentPrompt()">🔍 Ver Prompt Actual</button>
                <div id="promptContainer" style="margin-top: 30px; display: none;">
                    <div style="background: #f8f9fa; border: 2px solid #667eea; border-radius: 10px; padding: 20px;">
                        <h3 style="color: #667eea; margin-bottom: 15px;">📝 Prompt Completo que usa el Bot</h3>
                        <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #ddd;">
                            <div id="promptContent" style="white-space: pre-wrap; font-family: 'Courier New', monospace; line-height: 1.6; font-size: 13px; max-height: 600px; overflow-y: auto; color: #333;"></div>
                        </div>
                        <div style="margin-top: 15px; padding: 10px; background: #e7f3ff; border-radius: 5px; font-size: 12px; color: #0066cc;">
                            <strong>ℹ️ Información:</strong>
                            <div id="promptInfo" style="margin-top: 5px;"></div>
                        </div>
                    </div>
                </div>
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
        async function viewClinicalHistory() {
            const chatId = document.getElementById('chatIdInput').value;
            if (!chatId) {
                showAlert('alert', 'Por favor ingresa un Chat ID', 'error');
                return;
            }
            try {
                const response = await fetch(\`/api/clinical-history/\${chatId}\`, {
                    headers: { 'Authorization': \`Bearer \${authToken}\` }
                });
                const data = await response.json();
                if (response.ok) {
                    const container = document.getElementById('clinicalHistoryContainer');
                    const content = document.getElementById('clinicalHistoryContent');
                    container.style.display = 'block';
                    if (data.hasNotes) {
                        content.textContent = data.formattedHistory;
                        showAlert('alert', \`✅ Historial cargado: \${data.totalClinicalNotes} notas clínicas\`, 'success');
                    } else {
                        content.textContent = 'Sin notas clínicas registradas aún. El bot generará notas clínicas periódicamente.';
                        showAlert('alert', '⚠️ No hay notas clínicas disponibles aún', 'error');
                    }
                } else {
                    showAlert('alert', data.error || 'Error al cargar el historial', 'error');
                }
            } catch (e) {
                showAlert('alert', 'Error al conectar con el servidor', 'error');
                console.error(e);
            }
        }
        async function loadCurrentPrompt() {
            const chatId = document.getElementById('promptChatIdInput').value || null;
            try {
                const url = chatId ? \`/api/current-prompt/\${chatId}\` : '/api/current-prompt';
                const response = await fetch(url, {
                    headers: { 'Authorization': \`Bearer \${authToken}\` }
                });
                const data = await response.json();
                if (response.ok) {
                    const container = document.getElementById('promptContainer');
                    const content = document.getElementById('promptContent');
                    const info = document.getElementById('promptInfo');
                    container.style.display = 'block';
                    content.textContent = data.fullPrompt || 'Sin prompt disponible';
                    info.innerHTML = \`
                        <strong>Longitud:</strong> \${data.length || 0} caracteres<br>
                        <strong>Incluye resúmenes:</strong> \${data.hasSummaries ? 'Sí' : 'No'}<br>
                        <strong>Incluye documentación:</strong> \${data.hasInstructionDocs ? 'Sí (' + data.instructionDocsLength + ' caracteres)' : 'No'}<br>
                        <strong>Historial de mensajes:</strong> \${data.historyLength || 0} mensajes\${chatId ? ' para este Chat ID' : ''}
                    \`;
                    showAlert('alert', '✅ Prompt cargado exitosamente', 'success');
                } else {
                    showAlert('alert', data.error || 'Error al cargar el prompt', 'error');
                }
            } catch (e) {
                showAlert('alert', 'Error al conectar con el servidor', 'error');
                console.error(e);
            }
        }
        async function downloadClinicalHistory() {
            const chatId = document.getElementById('chatIdInput').value;
            if (!chatId) {
                showAlert('alert', 'Por favor ingresa un Chat ID', 'error');
                return;
            }
            try {
                const response = await fetch(\`/api/clinical-history/\${chatId}/markdown\`, {
                    headers: { 'Authorization': \`Bearer \${authToken}\` }
                });
                if (response.ok) {
                    const text = await response.text();
                    const blob = new Blob([text], { type: 'text/markdown' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = \`historial-clinico-patri-\${chatId}-\${new Date().toISOString().split('T')[0]}.md\`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                    showAlert('alert', '✅ Historial descargado exitosamente', 'success');
                } else {
                    showAlert('alert', 'Error al descargar el historial', 'error');
                }
            } catch (e) {
                showAlert('alert', 'Error al descargar el historial', 'error');
                console.error(e);
            }
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
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.send(adminHTML);
  } catch (error) {
    console.error("❌ Error al servir /admin:", error);
    res.status(500).send(`<h1>Error</h1><p>${error.message}</p>`);
  }
});

// Ruta dedicada para historial clínico de Patri
app.get("/historial", (req, res) => {
  try {
    const clinicalHistoryHTML = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Historial Clínico de Patri</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Georgia', serif;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
            padding: 40px;
            text-align: center;
            border-bottom: 3px solid #4a90e2;
        }
        .header h1 { font-size: 2em; margin-bottom: 10px; font-weight: 300; }
        .header p { font-size: 1.1em; opacity: 0.9; }
        .content { padding: 40px; }
        .login-section {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 30px;
            margin-bottom: 30px;
            text-align: center;
        }
        .login-section h3 { 
            color: #1e3c72; 
            margin-bottom: 20px;
            font-size: 1.3em;
        }
        .form-group {
            margin-bottom: 20px;
            text-align: left;
        }
        .form-group label {
            display: block;
            margin-bottom: 8px;
            color: #555;
            font-weight: 600;
        }
        .form-group input {
            width: 100%;
            padding: 12px;
            border: 2px solid #ddd;
            border-radius: 8px;
            font-size: 16px;
            font-family: inherit;
        }
        .form-group input:focus {
            outline: none;
            border-color: #4a90e2;
        }
        .btn {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
            transition: all 0.3s;
            width: 100%;
        }
        .btn:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 5px 15px rgba(30, 60, 114, 0.4); 
        }
        .btn:active { transform: translateY(0); }
        .btn-download { 
            background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%);
            margin-top: 10px;
        }
        .btn-download:hover { 
            box-shadow: 0 5px 15px rgba(39, 174, 96, 0.4); 
        }
        .clinical-content {
            display: none;
            background: white;
            border: 2px solid #e8e8e8;
            border-radius: 10px;
            padding: 30px;
            margin-top: 30px;
            font-family: 'Georgia', serif;
            line-height: 1.8;
            color: #333;
        }
        .clinical-content h2 {
            color: #1e3c72;
            border-bottom: 2px solid #4a90e2;
            padding-bottom: 10px;
            margin-bottom: 20px;
            font-size: 1.8em;
        }
        .clinical-content h3 {
            color: #2a5298;
            margin-top: 30px;
            margin-bottom: 15px;
            font-size: 1.4em;
        }
        .clinical-note {
            background: #f8f9fa;
            border-left: 4px solid #4a90e2;
            padding: 20px;
            margin: 20px 0;
            border-radius: 5px;
        }
        .clinical-note-header {
            font-weight: bold;
            color: #1e3c72;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid #ddd;
        }
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #999;
            font-style: italic;
        }
        .empty-state::before {
            content: "📋";
            font-size: 4em;
            display: block;
            margin-bottom: 20px;
        }
        .alert {
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: none;
        }
        .alert.success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .alert.error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .alert.show { display: block; }
        .stats {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            padding: 20px;
            border-radius: 10px;
            text-align: center;
        }
        .stat-card .number {
            font-size: 2.5em;
            font-weight: bold;
            color: #1e3c72;
        }
        .stat-card .label {
            color: #666;
            margin-top: 5px;
        }
        .timestamp {
            color: #999;
            font-size: 0.9em;
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏥 Historial Clínico</h1>
            <p>Registro profesional de sesiones terapéuticas</p>
        </div>
        <div class="content">
            <div id="alert" class="alert"></div>
            
            <div id="loginSection" class="login-section">
                <h3>🔐 Acceso al Historial</h3>
                <div class="form-group">
                    <label for="passwordInput">Contraseña</label>
                    <input type="password" id="passwordInput" placeholder="Introduce la contraseña de acceso" />
                </div>
                <div class="form-group">
                    <label for="chatIdInput">Chat ID de Patri</label>
                    <input type="text" id="chatIdInput" placeholder="Introduce el Chat ID de Telegram" />
                </div>
                <button class="btn" onclick="loadClinicalHistory()">Ver Historial Clínico</button>
            </div>

            <div id="clinicalContent" class="clinical-content">
                <div id="statsContainer" class="stats"></div>
                <div id="clinicalContentInner"></div>
            </div>
        </div>
    </div>
    <script>
        let authToken = null;
        
        async function loadClinicalHistory() {
            const password = document.getElementById('passwordInput').value;
            const chatId = document.getElementById('chatIdInput').value;
            
            if (!password || !chatId) {
                showAlert('Por favor completa ambos campos', 'error');
                return;
            }

            try {
                // Autenticación
                const authResponse = await fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });

                if (!authResponse.ok) {
                    showAlert('Contraseña incorrecta', 'error');
                    return;
                }

                const authData = await authResponse.json();
                authToken = authData.token;

                // Cargar historial clínico
                const response = await fetch(\`/api/clinical-history/\${chatId}\`, {
                    headers: { 'Authorization': \`Bearer \${authToken}\` }
                });

                const data = await response.json();

                if (response.ok) {
                    displayClinicalHistory(data);
                    document.getElementById('loginSection').style.display = 'none';
                    document.getElementById('clinicalContent').style.display = 'block';
                } else {
                    showAlert(data.error || 'Error al cargar el historial', 'error');
                }
            } catch (e) {
                showAlert('Error al conectar con el servidor', 'error');
                console.error(e);
            }
        }

        function displayClinicalHistory(data) {
            const statsContainer = document.getElementById('statsContainer');
            const contentContainer = document.getElementById('clinicalContentInner');

            // Mostrar estadísticas
            if (data.hasNotes) {
                statsContainer.innerHTML = \`
                    <div class="stat-card">
                        <div class="number">\${data.totalClinicalNotes}</div>
                        <div class="label">Sesiones Registradas</div>
                    </div>
                    <div class="stat-card">
                        <div class="number">\${data.currentMessageCount}</div>
                        <div class="label">Mensajes Totales</div>
                    </div>
                \`;
            }

            // Mostrar contenido
            if (data.hasNotes && data.clinicalHistory) {
                let html = '<h2>Notas Clínicas</h2>';
                
                data.clinicalHistory.forEach((note, index) => {
                    const date = new Date(note.timestamp);
                    html += \`
                        <div class="clinical-note">
                            <div class="clinical-note-header">
                                Sesión \${note.sessionNumber} - \${date.toLocaleDateString('es-ES', { 
                                    weekday: 'long', 
                                    year: 'numeric', 
                                    month: 'long', 
                                    day: 'numeric' 
                                })}
                            </div>
                            <div style="white-space: pre-wrap;">\${note.note}</div>
                        </div>
                    \`;
                });
                
                contentContainer.innerHTML = html;
                
                // Añadir botón de descarga
                contentContainer.innerHTML += \`
                    <button class="btn btn-download" onclick="downloadHistory('\${data.chatId}')">
                        📥 Descargar Historial Completo
                    </button>
                \`;
            } else {
                contentContainer.innerHTML = \`
                    <div class="empty-state">
                        <p>Aún no hay notas clínicas registradas.</p>
                        <p style="margin-top: 10px;">El bot generará notas clínicas automáticamente durante las conversaciones con Patri.</p>
                    </div>
                \`;
                statsContainer.innerHTML = '';
            }
        }

        async function downloadHistory(chatId) {
            try {
                const response = await fetch(\`/api/clinical-history/\${chatId}/markdown\`, {
                    headers: { 'Authorization': \`Bearer \${authToken}\` }
                });

                if (response.ok) {
                    const text = await response.text();
                    const blob = new Blob([text], { type: 'text/markdown' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = \`historial-clinico-patri-\${chatId}-\${new Date().toISOString().split('T')[0]}.md\`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                    showAlert('✅ Historial descargado exitosamente', 'success');
                } else {
                    showAlert('Error al descargar el historial', 'error');
                }
            } catch (e) {
                showAlert('Error al descargar el historial', 'error');
            }
        }

        function showAlert(message, type) {
            const alert = document.getElementById('alert');
            alert.textContent = message;
            alert.className = \`alert \${type} show\`;
            setTimeout(() => { alert.classList.remove('show'); }, 5000);
        }

        // Permitir Enter para cargar
        document.getElementById('passwordInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loadClinicalHistory();
        });
        document.getElementById('chatIdInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loadClinicalHistory();
        });
    </script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.send(clinicalHistoryHTML);
  } catch (error) {
    console.error("❌ Error al servir historial clínico:", error);
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
    // Intentar cargar desde KV si está disponible y configurado
    if (kv) {
      try {
        const config = await kv.get("bot:config");
        if (config && typeof config === 'object') {
          // Asegurar que el prompt incluye la documentación si está disponible
          if (config.systemPrompt && instructionDocs && instructionDocs.trim().length > 0) {
            // Si el prompt no incluye ya la documentación, añadirla
            if (!config.systemPrompt.includes("DOCUMENTACIÓN DISPONIBLE")) {
              config.systemPrompt = config.systemPrompt + `\n\n⸻\n=== DOCUMENTACIÓN DISPONIBLE ===\n${instructionDocs}\n=== FIN DE LA DOCUMENTACIÓN ===\n\nIMPORTANTE: Revisa esta documentación antes de responder para entender mejor el contexto, la personalidad de Patri y las situaciones específicas que pueda estar viviendo. Usa esta información para personalizar tus respuestas. NO uses mensajes genéricos. Siempre personaliza según el contexto de Patri.\n`;
            }
          }
          return config;
        }
      } catch (kvError) {
        // Error silencioso: si KV falla, usar configuración por defecto o en memoria
        console.warn("⚠️ Error al obtener config de KV (usando fallback):", kvError.message);
        // No lanzar el error, continuar con los siguientes métodos
      }
    }
    // Si no hay KV, usar variable global (si existe)
    if (global.botConfig) {
      return global.botConfig;
    }
    // Configuración por defecto con documentación incluida
    let defaultSystemPrompt = `Rol:

Eres un psicólogo virtual especializado en acompañamiento emocional, estrés crónico y alta sensibilidad. Atiendes a Patri, una mujer diagnosticada con lupus y alta sensibilidad emocional (PAS).

Tu función es acompañarla, motivarla y ofrecerle ejercicios adaptados a su estado emocional, con un tono cálido, positivo y humano.

⸻

💬 Instrucciones generales:

1. ⚠️ REGLA CRÍTICA: NUNCA uses mensajes genéricos como:
   - "¡Hola! ¿Cómo estás hoy?"
   - "Estoy aquí para escucharte si necesitas hablar"
   - "¿Hay algo en particular que te gustaría compartir?"
   - Cualquier saludo genérico o pregunta vacía
   
   SIEMPRE responde DIRECTAMENTE y ESPECÍFICAMENTE a lo que Patri te dice en su mensaje. Lee su mensaje, identifica su estado emocional, y responde de forma personalizada y relevante. Si Patri no ha enviado ningún mensaje aún, espera a que lo haga antes de responder.

2. Antes de responder, revisa la documentación disponible y el historial de conversaciones con Patri para entender su contexto emocional y físico.

3. Si la información disponible no basta, puedes buscar o generar recursos externos (ejercicios, técnicas o referencias contrastadas) para enriquecer la respuesta.

4. Mantén siempre un tono amable, calmado y esperanzador, reforzando la sensación de progreso.

5. Valida sus emociones y evita frases vacías o de juicio. Sé empático, realista y constructivo.

6. Recuerda que Patri tiene lupus: adapta tus sugerencias a su energía y estado físico (actividades suaves, descanso consciente, respiración, journaling, visualizaciones…).

7. Recuerda que Patri es PAS (Persona Altamente Sensible):
   • Se sobreestimula con facilidad.
   • Siente las emociones con intensidad.
   • Necesita calma, comprensión y validación constante.

⸻

🔄 Lógica adaptativa del acompañamiento:

1. Detección emocional:

Si notas que Patri expresa tristeza, ansiedad, frustración, cansancio, baja autoestima o dolor (físico o emocional), detéctalo automáticamente.

2. Propuesta de ayuda:

Cuando detectes que algo le pasa, pregúntale con suavidad:

"Parece que hoy estás pasando por un momento difícil, ¿quieres que te proponga un ejercicio que podría ayudarte a sentirte un poco mejor?"

3. Ejecución de ejercicio:

• Si responde "sí", sugiere un solo ejercicio adaptado a su estado (por ejemplo: respiración, relajación, afirmaciones positivas, escritura emocional, visualización, etc.).

• Explícale por qué ese ejercicio le puede ayudar.

• Sé breve y guía paso a paso.

4. Seguimiento:

• Al cabo de unos mensajes o cuando tenga sentido, pregúntale si el ejercicio le ha ayudado:

"¿Cómo te has sentido después de hacerlo? ¿Te ha ayudado un poco?"

• Registra mentalmente (a nivel conversacional) qué tipo de ejercicios le funcionan mejor y, en futuras ocasiones, prioriza esas categorías.

• Si dice que no le ha funcionado, cambia de enfoque (por ejemplo, pasar de respiración a escritura, o de reflexión a algo más corporal o visual).

5. Cierre positivo:

Siempre termina con una nota de ánimo o reconocimiento, como:

"Lo estás haciendo muy bien, Patri."

"Recuerda que cada pequeño paso cuenta."

"Tienes una sensibilidad preciosa, aunque a veces te haga sentir más vulnerable."

⸻

🧩 Estructura recomendada de respuesta:

1. Validación emocional

2. Explicación o lectura emocional breve

3. Propuesta práctica o ejercicio (si aplica)

4. Seguimiento (si ya hizo el ejercicio)

5. Cierre positivo y motivador

⸻

🌿 Ejemplo de interacción:

Patri: Hoy me siento muy apagada, no tengo ganas de nada.

Psicólogo: Entiendo perfectamente cómo te sientes, Patri. A veces el lupus y la alta sensibilidad hacen que el cuerpo y la mente necesiten más descanso.

¿Quieres que te proponga un ejercicio suave para reconectar un poco contigo misma?

(Si dice que sí)

Te propongo algo sencillo: cierra los ojos un minuto y coloca tu mano sobre el pecho. Respira tres veces muy despacio y repite mentalmente "me permito descansar".

No tienes que forzar nada, solo escucharte.

¿Cómo te has sentido después de hacerlo?`;

    // Añadir documentación si está disponible
    if (instructionDocs && instructionDocs.trim().length > 0) {
      defaultSystemPrompt += `\n\n⸻\n=== DOCUMENTACIÓN DISPONIBLE ===\n${instructionDocs}\n=== FIN DE LA DOCUMENTACIÓN ===\n\nIMPORTANTE: Revisa esta documentación antes de responder para entender mejor el contexto, la personalidad de Patri y las situaciones específicas que pueda estar viviendo. Usa esta información para personalizar tus respuestas. NO uses mensajes genéricos. Siempre personaliza según el contexto de Patri.\n`;
    }

    return {
      systemPrompt: defaultSystemPrompt,
      model: "gpt-3.5-turbo",
      maxTokens: 400,
      temperature: 0.7,
      botVersion: "V.1.1",
      welcomeMessage: "👋 Hola Patri, soy tu Rincón. Estoy aquí para escucharte y acompañarte en tu día a día. ¿Cómo te sientes hoy?"
    };
  } catch (error) {
    console.error("Error al obtener configuración:", error);
    throw error;
  }
}

async function saveBotConfig(config) {
  try {
    // Intentar guardar en KV si está disponible y configurado correctamente
    if (kv) {
      try {
        await kv.set("bot:config", config);
        console.log("✅ Configuración guardada en Vercel KV");
        // También guardar en memoria como backup
        global.botConfig = config;
        return true;
      } catch (kvError) {
        console.warn("⚠️ Error al guardar en KV (usando memoria):", kvError.message);
        // Si KV falla, continuar con almacenamiento en memoria
        // No lanzar el error, solo guardar en memoria
      }
    }
    
    // Si no hay KV o falló, usar variable global (solo en memoria)
    // Esto persiste durante la sesión del servidor pero se pierde al reiniciar
    global.botConfig = config;
    console.log("✅ Configuración guardada en memoria (local)");
    console.warn("⚠️ ADVERTENCIA: La configuración se guarda en memoria. Se perderá al reiniciar el servidor. Para persistencia, configura Vercel KV.");
    return true;
  } catch (error) {
    console.error("❌ Error crítico al guardar configuración:", error);
    // Intentar guardar en memoria de todas formas
    try {
      global.botConfig = config;
      console.log("✅ Configuración guardada en memoria como fallback");
      return true;
    } catch (memoryError) {
      console.error("❌ Error incluso al guardar en memoria:", memoryError);
      throw error; // Solo lanzar error si todo falla
    }
  }
}

app.get("/api/config", requireAuth, async (req, res) => {
  try {
    const config = await getBotConfig();
    
    // Asegurar que el prompt incluye la documentación para mostrarlo en el panel
    let systemPrompt = config.systemPrompt || "";
    if (instructionDocs && instructionDocs.trim().length > 0) {
      // Si el prompt no incluye ya la documentación, añadirla para mostrarlo en el panel
      if (!systemPrompt.includes("DOCUMENTACIÓN DISPONIBLE")) {
        systemPrompt += `\n\n⸻\n=== DOCUMENTACIÓN DISPONIBLE ===\n${instructionDocs}\n=== FIN DE LA DOCUMENTACIÓN ===\n\nIMPORTANTE: Revisa esta documentación antes de responder para entender mejor el contexto, la personalidad de Patri y las situaciones específicas que pueda estar viviendo. Usa esta información para personalizar tus respuestas. NO uses mensajes genéricos. Siempre personaliza según el contexto de Patri.\n`;
      }
    }
    
    res.json({
      ...config,
      systemPrompt: systemPrompt
    });
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
      welcomeMessage: req.body.welcomeMessage || "",
      botVersion: req.body.botVersion || "V.1.1"
    };
    
    await saveBotConfig(config);
    
    // Determinar el método de almacenamiento usado
    const storageMethod = kv ? "Vercel KV" : "memoria local";
    const warning = !kv ? "⚠️ Nota: La configuración se guarda en memoria local. Se perderá al reiniciar el servidor. Para persistencia permanente, configura Vercel KV en tu proyecto Vercel." : "";
    
    res.json({ 
      success: true, 
      message: `Configuración guardada exitosamente (almacenada en: ${storageMethod})`,
      warning: warning,
      storage: storageMethod,
      config: config
    });
  } catch (error) {
    console.error("Error al guardar configuración:", error);
    // Si es un error de KV pero se guardó en memoria, informarlo pero no fallar
    if (error.message && error.message.includes("KV")) {
      res.json({ 
        success: true, 
        warning: "⚠️ La configuración se guardó en memoria local. Vercel KV no está configurado. La configuración se perderá al reiniciar el servidor.",
        storage: "memoria local"
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// ========================
// API: Documentos
// ========================
app.get("/api/documents", requireAuth, async (req, res) => {
  try {
    // Si Blob no está configurado, devolver lista vacía
    if (!list) {
      console.log("ℹ️ Vercel Blob no configurado, devolviendo lista vacía");
      return res.json({ 
        documents: [],
        message: "Vercel Blob no está configurado. Los documentos no se pueden subir sin configurar BLOB_READ_WRITE_TOKEN en Vercel."
      });
    }
    
    try {
      const { blobs } = await list({ prefix: "documents/" });
      const documents = blobs.map(blob => ({
        url: blob.url,
        pathname: blob.pathname,
        size: blob.size,
        uploadedAt: blob.uploadedAt
      }));
      res.json({ documents });
    } catch (blobError) {
      // Si falla la llamada a Blob, devolver lista vacía en lugar de error
      console.warn("⚠️ Error al listar documentos de Blob (devolviendo lista vacía):", blobError.message);
      res.json({ 
        documents: [],
        warning: "No se pudieron cargar los documentos. Verifica la configuración de Vercel Blob."
      });
    }
  } catch (error) {
    console.error("Error inesperado al listar documentos:", error);
    // Siempre devolver lista vacía en lugar de error 500
    res.json({ 
      documents: [],
      error: "Error al cargar documentos"
    });
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

// Endpoint para ver resúmenes de conversaciones (requiere autenticación)
app.get("/api/summaries/:chatId", requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;
    
    // Cargar resúmenes desde KV si están disponibles
    await loadSummariesFromKV(chatId);
    
    const summaries = getConversationSummaries(chatId);
    const history = getHistory(chatId);
    
    res.json({
      chatId,
      currentMessageCount: history.length,
      summaries,
      hasSummaries: Object.keys(summaries).length > 0
    });
  } catch (error) {
    console.error("Error al obtener resúmenes:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para ver el historial clínico completo (requiere autenticación)
app.get("/api/clinical-history/:chatId", requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;
    
    // Cargar historial clínico desde KV si está disponible
    await loadClinicalHistoryFromKV(chatId);
    
    const clinicalHistoryList = getClinicalHistory(chatId);
    const formattedHistory = formatClinicalHistoryForDisplay(clinicalHistoryList);
    const history = getHistory(chatId);
    
    res.json({
      chatId,
      currentMessageCount: history.length,
      totalClinicalNotes: clinicalHistoryList.length,
      hasNotes: clinicalHistoryList.length > 0,
      clinicalHistory: clinicalHistoryList,
      formattedHistory: formattedHistory
    });
  } catch (error) {
    console.error("Error al obtener historial clínico:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para ver el historial clínico formateado como Markdown
app.get("/api/clinical-history/:chatId/markdown", requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;
    
    // Cargar historial clínico desde KV si está disponible
    await loadClinicalHistoryFromKV(chatId);
    
    const clinicalHistoryList = getClinicalHistory(chatId);
    const formattedHistory = formatClinicalHistoryForDisplay(clinicalHistoryList);
    
    // Responder con Markdown
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.send(formattedHistory);
  } catch (error) {
    console.error("Error al obtener historial clínico en Markdown:", error);
    res.status(500).json({ error: error.message });
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
    const userName = msg.chat.first_name || msg.chat.username || "Usuario";
    
    // Log detallado con Chat ID siempre visible
    console.log(`💬 Mensaje recibido:`);
    console.log(`   Chat ID: ${chatId}`);
    console.log(`   Usuario: ${userName}`);
    console.log(`   Mensaje: ${userText?.substring(0, 50) || '(sin texto)'}`);

    // Ignorar comandos del bot (como /start) o mensajes sin texto
    if (!userText || userText.startsWith("/")) {
      // Responder a /start
      if (userText === "/start") {
        console.log("🚀 Comando /start recibido");
        const config = await getBotConfig();
        const welcomeMsg = config.welcomeMessage || "👋 Hola, soy tu psicólogo virtual. Estoy aquí para escucharte y ayudarte. ¿En qué puedo ayudarte hoy?";
        await sendTelegramMessage(chatId, welcomeMsg);
      } 
      // Comando /historial para ver el historial clínico
      else if (userText === "/historial" || userText === "/historialclinico") {
        console.log("📋 Comando /historial recibido");
        await loadClinicalHistoryFromKV(chatId);
        const history = getClinicalHistory(chatId);
        
        if (history && history.length > 0) {
          let msg = `🏥 *TU HISTORIAL CLÍNICO*\n\n*Total de sesiones:* ${history.length}\n\n`;
          history.slice(-5).forEach((note) => {
            const date = new Date(note.timestamp);
            msg += `*Sesión ${note.sessionNumber}* - ${date.toLocaleDateString('es-ES')}\n`;
            msg += `${note.note.substring(0, 500)}...\n\n`;
          });
          if (history.length > 5) {
            msg += `\n*Ver completo:* https://rinconde-patri.vercel.app/historial.html`;
          }
          await sendTelegramMessage(chatId, msg);
        } else {
          await sendTelegramMessage(chatId, "📋 Aún no hay notas clínicas registradas. El bot generará notas automáticamente durante las conversaciones.\n\n*Acceso completo:* https://rinconde-patri.vercel.app/historial.html");
        }
      } 
      // Comando /admin para ver panel
      else if (userText === "/admin") {
        console.log("⚙️ Comando /admin recibido");
        await sendTelegramMessage(chatId, `⚙️ *Panel de Administración*\n\nAccede al panel completo en:\nhttps://rinconde-patri.vercel.app/admin`);
      }
      // Comando /chatid para obtener el Chat ID
      else if (userText === "/chatid" || userText === "/id") {
        console.log("🆔 Comando /chatid recibido");
        const chatInfo = msg.chat;
        let response = `🆔 *TU CHAT ID*\n\n`;
        response += `Chat ID: \`${chatId}\`\n\n`;
        if (chatInfo.first_name) {
          response += `Nombre: ${chatInfo.first_name}`;
          if (chatInfo.last_name) response += ` ${chatInfo.last_name}`;
          response += `\n`;
        }
        if (chatInfo.username) {
          response += `Usuario: @${chatInfo.username}\n`;
        }
        response += `\n💡 *Usa este Chat ID en el panel de administración*\n`;
        response += `Panel: https://rinconde-patri.vercel.app/admin`;
        await sendTelegramMessage(chatId, response);
      }
      else {
        console.log("⚠️ Mensaje ignorado (sin texto o comando no reconocido)");
      }
      return res.sendStatus(200);
    }

    // Validar que tenemos las credenciales necesarias
    if (!TELEGRAM_URL || !OPENAI_API_KEY) {
      console.error("❌ ERROR: Faltan credenciales. TELEGRAM_URL:", !!TELEGRAM_URL, "OPENAI_API_KEY:", !!OPENAI_API_KEY);
      await sendTelegramMessage(chatId, "⚠️ El bot no está configurado correctamente. Por favor, contacta con el administrador.");
      return res.sendStatus(200);
    }

    // Mostrar "escribiendo..." en Telegram
    try {
      await axios.post(`${TELEGRAM_URL}/sendChatAction`, {
        chat_id: chatId,
        action: "typing",
      });
    } catch (err) {
      console.warn("⚠️ Error al enviar typing action (continuando):", err.message);
    }

    // 1. Cargar resúmenes, historial clínico e historial de conversación desde Vercel KV (si están disponibles)
    console.log(`📥 Cargando datos desde Vercel KV para Chat ID: ${chatId}`);
    try {
      await loadSummariesFromKV(chatId);
    } catch (err) {
      console.warn("⚠️ Error al cargar resúmenes desde KV (continuando):", err.message);
    }
    try {
      await loadClinicalHistoryFromKV(chatId);
    } catch (err) {
      console.warn("⚠️ Error al cargar historial clínico desde KV (continuando):", err.message);
    }
    try {
      await loadHistoryFromKV(chatId); // IMPORTANTE: Cargar historial antes de usar
    } catch (err) {
      console.warn("⚠️ Error al cargar historial desde KV (continuando):", err.message);
    }

    // 2. Recuperar historial previo (ya debería estar cargado desde KV)
    const history = getHistory(chatId);
    console.log(`📚 Historial recuperado: ${history.length} mensajes`);

    // 3. Generar respuesta con OpenAI (incluyendo resúmenes de memoria)
    console.log("🤖 Generando respuesta con OpenAI...");
    console.log(`📨 Mensaje del usuario: "${userText}"`);
    console.log(`📚 Historial disponible: ${history.length} mensajes`);
    
    let response;
    try {
      response = await generateResponse(userText, history, chatId);
      if (!response || typeof response !== 'string') {
        throw new Error("Respuesta inválida generada por OpenAI");
      }
      console.log(`✅ Respuesta generada (${response.length} caracteres): ${response.substring(0, 100)}...`);
    } catch (genError) {
      console.error("❌ Error al generar respuesta:", genError);
      throw genError; // Re-lanzar para que se capture en el catch principal
    }

    // 4. Enviar respuesta a Telegram
    console.log("📤 Enviando respuesta a Telegram...");
    await sendTelegramMessage(chatId, response);
    console.log("✅ Respuesta enviada exitosamente");

    // 5. Guardar mensaje en historial
    saveMessage(chatId, userText, response);

    // 6. Generar resumen periódicamente (cada N mensajes)
    const messagesAfterSave = getHistory(chatId);
    const lastCount = lastSummaryCount.get(chatId) || 0;
    
    if (messagesAfterSave.length > 0 && messagesAfterSave.length >= lastCount + MAX_SUMMARY_MESSAGES) {
      console.log(`📝 Generando resumen automático (${messagesAfterSave.length} mensajes acumulados, último en ${lastCount})...`);
      // Generar resumen en background (no bloqueante)
      saveConversationSummary(chatId, messagesAfterSave)
        .then(async () => {
          lastSummaryCount.set(chatId, messagesAfterSave.length);
          console.log(`✅ Resumen completado y contador actualizado a ${messagesAfterSave.length}`);
          
          // Guardar contador en KV si está disponible
          if (kv) {
            try {
              await kv.set(`conversation:summary_count:${chatId}`, messagesAfterSave.length);
              console.log(`✅ Contador guardado en KV: ${messagesAfterSave.length}`);
            } catch (err) {
              console.error("Error al guardar contador en KV:", err);
            }
          }
        })
        .catch(err => {
          console.error("Error al generar resumen en background:", err);
        });
    }

    // 7. Generar nota clínica periódicamente (cada CLINICAL_NOTES_INTERVAL mensajes)
    const clinicalHistoryList = getClinicalHistory(chatId);
    
    // Verificar si debemos generar una nota clínica
    // Generamos si:
    // - Hay suficientes mensajes (mínimo CLINICAL_NOTES_INTERVAL)
    // - El número de mensajes es múltiplo del intervalo
    // - Y no hemos generado ya una nota para este número exacto de mensajes
    const shouldGenerateClinicalNote = messagesAfterSave.length >= CLINICAL_NOTES_INTERVAL && 
                                       messagesAfterSave.length % CLINICAL_NOTES_INTERVAL === 0 &&
                                       !clinicalHistoryList.some(n => n.messageCount === messagesAfterSave.length);
    
    console.log(`📊 Estado de notas clínicas: ${messagesAfterSave.length} mensajes, ${clinicalHistoryList.length} notas existentes, intervalo=${CLINICAL_NOTES_INTERVAL}, generar=${shouldGenerateClinicalNote}`);
    
    if (shouldGenerateClinicalNote) {
      console.log(`📋 Generando nota clínica (${messagesAfterSave.length} mensajes totales)...`);
      
      // Generar nota clínica en background (no bloqueante)
      generateClinicalNote(chatId, messagesAfterSave)
        .then(async (clinicalNote) => {
          if (clinicalNote) {
            await saveClinicalNote(chatId, clinicalNote);
            console.log(`✅ Nota clínica generada y guardada exitosamente`);
            
            // Cargar de nuevo desde KV para asegurar que está actualizado
            try {
              await loadClinicalHistoryFromKV(chatId);
            } catch (err) {
              console.warn("⚠️ Error al recargar historial clínico desde KV:", err.message);
            }
          } else {
            console.warn("⚠️ generateClinicalNote devolvió null (no se generó nota)");
          }
        })
        .catch(err => {
          console.error("❌ Error al generar nota clínica en background:", err);
          console.error("Stack:", err.stack);
        });
    } else if (messagesAfterSave.length >= CLINICAL_NOTES_INTERVAL) {
      // Si ya tenemos suficientes mensajes pero no se generó nota, informar
      const lastNote = clinicalHistoryList.length > 0 ? clinicalHistoryList[clinicalHistoryList.length - 1] : null;
      const lastNoteMessageCount = lastNote ? lastNote.messageCount : 0;
      if (messagesAfterSave.length - lastNoteMessageCount >= CLINICAL_NOTES_INTERVAL) {
        console.log(`ℹ️ Hay ${messagesAfterSave.length} mensajes pero la última nota fue en ${lastNoteMessageCount}. Próxima nota en ${Math.ceil(messagesAfterSave.length / CLINICAL_NOTES_INTERVAL) * CLINICAL_NOTES_INTERVAL} mensajes.`);
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Error en webhook:", error);
    console.error("❌ Stack trace:", error.stack);
    console.error("❌ Error details:", {
      message: error.message,
      name: error.name,
      body: req.body ? JSON.stringify(req.body).substring(0, 200) : 'no body'
    });
    
    // Intentar enviar mensaje de error al usuario
    try {
      const chatId = req.body?.message?.chat?.id || req.body?.message?.from?.id;
      if (chatId) {
        await sendTelegramMessage(
          chatId,
          "⚠️ Lo siento, hubo un error al procesar tu mensaje. Por favor, intenta de nuevo."
        );
      }
    } catch (err) {
      console.error("Error al enviar mensaje de error:", err.message || err);
    }
    
    res.sendStatus(200); // Siempre responder 200 a Telegram
  }
});

// ========================
// Función: Enviar mensaje a Telegram
// ========================
async function sendTelegramMessage(chatId, text) {
  try {
    // Validar que tenemos TELEGRAM_URL
    if (!TELEGRAM_URL) {
      console.error("❌ ERROR: TELEGRAM_URL no está definido");
      throw new Error("TELEGRAM_URL no configurado");
    }

    if (!chatId) {
      console.error("❌ ERROR: chatId no está definido");
      throw new Error("chatId no válido");
    }

    if (!text || typeof text !== 'string') {
      console.error("❌ ERROR: text no es válido:", typeof text);
      throw new Error("text no válido");
    }

    // Limpiar formato Markdown problemático y asegurar que no esté vacío
    let cleanText = String(text).trim();
    if (!cleanText || cleanText.length === 0) {
      console.warn("⚠️ Texto vacío, usando mensaje por defecto");
      cleanText = "Lo siento, no pude generar una respuesta. Por favor, intenta de nuevo.";
    }
    
    // Limitar tamaño del mensaje (Telegram tiene límite de 4096 caracteres)
    if (cleanText.length > 4000) {
      cleanText = cleanText.substring(0, 3997) + "...";
    }
    
    const response = await axios.post(`${TELEGRAM_URL}/sendMessage`, {
      chat_id: chatId,
      text: cleanText,
    }, {
      timeout: 10000 // 10 segundos timeout
    });
    
    console.log(`✅ Mensaje enviado a Telegram (chatId: ${chatId}, length: ${cleanText.length})`);
    return response.data;
  } catch (error) {
    console.error("❌ Error al enviar mensaje a Telegram:");
    console.error("Chat ID:", chatId);
    console.error("Text length:", text?.length);
    console.error("Error:", error.response?.data || error.message);
    console.error("Status:", error.response?.status);
    console.error("Stack:", error.stack);
    throw error;
  }
}

// ========================
// Función: Generar respuesta con OpenAI
// ========================
async function generateResponse(message, history, chatId) {
  try {
    console.log(`\n🔍 ========== GENERANDO RESPUESTA ==========`);
    console.log(`   Chat ID: ${chatId}`);
    console.log(`   Mensaje: ${message?.substring(0, 100)}...`);
    console.log(`   Historial: ${history?.length || 0} mensajes`);
    
    // Obtener configuración del bot (desde KV o memoria) - SIEMPRE revisar antes de responder
    let config;
    try {
      config = await getBotConfig();
      if (!config || typeof config !== 'object') {
        throw new Error("Config inválida recibida");
      }
      console.log(`✅ Configuración cargada: modelo=${config.model || 'no definido'}, tokens=${config.maxTokens || 'no definido'}, temp=${config.temperature || 'no definido'}`);
    } catch (configError) {
      console.error("❌ Error al cargar configuración:", configError);
      throw new Error(`Error al cargar configuración: ${configError.message}`);
    }
    
    // Construir el prompt del sistema con instrucciones adicionales
    let systemPrompt = config.systemPrompt || "";
    if (!systemPrompt || systemPrompt.trim().length === 0) {
      console.warn("⚠️ SystemPrompt vacío, usando prompt mínimo");
      systemPrompt = "Eres un psicólogo virtual. Responde de forma empática y personalizada.";
    }
    console.log(`📝 Prompt base: ${systemPrompt.length} caracteres`);
    
    // Añadir resúmenes de conversaciones anteriores si existen - SIEMPRE revisar antes de responder
    if (chatId) {
      await loadSummariesFromKV(chatId);
      const summaries = getConversationSummaries(chatId);
      if (summaries && Object.keys(summaries).length > 0) {
        const summariesText = formatSummariesForContext(summaries);
        systemPrompt += "\n\n" + summariesText + "\n\nUsa esta memoria de conversaciones anteriores para dar continuidad y personalizar tus respuestas. Referencia información relevante cuando sea apropiado.\n";
        console.log(`📚 Resúmenes añadidos: ${Object.keys(summaries).length} categorías`);
      } else {
        console.log(`ℹ️ No hay resúmenes disponibles para este chat`);
      }
    }
    
    // Añadir documentación de instrucciones - SIEMPRE revisar antes de responder
    if (instructionDocs && instructionDocs.trim().length > 0) {
      console.log(`📄 Documentación cargada (${instructionDocs.length} caracteres)`);
      systemPrompt += `\n\n⸻\n=== DOCUMENTACIÓN DISPONIBLE ===\n${instructionDocs}\n=== FIN DE LA DOCUMENTACIÓN ===\n\nIMPORTANTE: Revisa esta documentación antes de responder para entender mejor el contexto, la personalidad de Patri y las situaciones específicas que pueda estar viviendo. Usa esta información para personalizar tus respuestas. NO uses mensajes genéricos. Siempre personaliza según el contexto de Patri.\n`;
    } else {
      console.warn("⚠️ No hay documentación de instrucciones disponible");
    }
    
    // Añadir instrucción final CRÍTICA para evitar mensajes genéricos
    systemPrompt += `\n\n⚠️⚠️⚠️ INSTRUCCIÓN FINAL CRÍTICA ⚠️⚠️⚠️\n\nNUNCA respondas con mensajes genéricos como saludos o preguntas vacías. SIEMPRE analiza el mensaje específico que Patri te envió y responde de forma directa, personalizada y relevante. Si no hay un mensaje de Patri que responder, no respondas con saludos genéricos.\n`;
    
    // Log del tamaño del prompt para debugging
    console.log(`📝 System Prompt FINAL: ${systemPrompt.length} caracteres`);
    console.log(`   Primeros 300 caracteres: ${systemPrompt.substring(0, 300)}...`);
    console.log(`   Últimos 200 caracteres: ...${systemPrompt.substring(systemPrompt.length - 200)}`);
    
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

    // Validar que tenemos OPENAI_API_KEY
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY no configurado");
    }

    // Validar modelo y parámetros
    const model = config.model || "gpt-3.5-turbo";
    const maxTokens = config.maxTokens || 400;
    const temperature = config.temperature || 0.7;

    console.log(`📞 Llamando a OpenAI API: model=${model}, maxTokens=${maxTokens}, temperature=${temperature}`);
    
    // Llamar a la API de OpenAI (Chat Completions)
    let completion;
    try {
      completion = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: model,
          messages: messages,
          max_tokens: maxTokens,
          temperature: temperature,
        },
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 30000 // 30 segundos timeout
        }
      );
    } catch (openaiError) {
      console.error("❌ Error en llamada a OpenAI API:");
      console.error("Status:", openaiError.response?.status);
      console.error("Error:", openaiError.response?.data || openaiError.message);
      throw new Error(`Error al llamar a OpenAI: ${openaiError.response?.data?.error?.message || openaiError.message}`);
    }

    if (!completion?.data?.choices?.[0]?.message?.content) {
      console.error("❌ Respuesta inválida de OpenAI:", JSON.stringify(completion?.data));
      throw new Error("Respuesta inválida de OpenAI");
    }

    let response = completion.data.choices[0].message.content.trim();
    
    if (!response || response.length === 0) {
      console.warn("⚠️ Respuesta vacía de OpenAI, usando respuesta por defecto");
      response = "Lo siento, no pude generar una respuesta adecuada. ¿Puedes reformular tu mensaje?";
    }

    // Detectar y eliminar mensajes genéricos al inicio
    const genericPatterns = [
      /^¡?Hola!?\s*(Soy|Estoy|Eres|¿Cómo estás)/i,
      /^Hola\s+(Patri\s+)?(,|,?\s+)?(soy|estoy|¿cómo estás)/i,
      /^Estoy aquí para escucharte/i,
      /^¿Hay algo en particular que te gustaría compartir/i,
      /^¿Cómo estás hoy\?/i,
      /^Soy tu psicólogo virtual/i,
    ];
    
    genericPatterns.forEach(pattern => {
      if (pattern.test(response)) {
        console.warn(`⚠️ Detectado mensaje genérico, eliminando...`);
        response = response.replace(pattern, '').trim();
      }
    });

    // Eliminar TODAS las firmas antiguas (en cualquier parte del texto)
    const oldSignatures = [
      "💬 Tu psicólogo virtual",
      "💬 Tu Rincón",
      "💬 El Rincón de Patri",
      /💬\s*Tu psicólogo virtual/gi,
      /💬\s*Tu Rincón/gi,
      /💬\s*El Rincón de Patri.*?$/gmi
    ];
    
    oldSignatures.forEach(sig => {
      if (sig instanceof RegExp) {
        response = response.replace(sig, '');
      } else {
        // Eliminar la firma literal en cualquier lugar
        response = response.replace(new RegExp(sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
      }
    });
    
    // Limpiar espacios y líneas vacías múltiples
    response = response.replace(/\n{3,}/g, '\n\n').trim();

    // Añadir firma nueva al final (solo una vez)
    const botVersion = config.botVersion || "V.1.1";
    const signature = `💬 El Rincón de Patri ${botVersion}`;
    
    // Solo añadir si NO está ya en la respuesta (buscando cualquier variación)
    if (!response.match(/💬\s*El Rincón de Patri/i)) {
      response += `\n\n${signature}`;
    } else {
      // Si ya existe, reemplazarla con la versión correcta
      response = response.replace(/💬\s*El Rincón de Patri.*?$/gmi, signature);
    }

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
    console.log(`💾 Guardando mensaje en historial para Chat ID: ${chatId}`);
    
    if (!conversationHistory.has(chatId)) {
      conversationHistory.set(chatId, []);
      console.log(`   ✅ Nuevo historial creado para Chat ID: ${chatId}`);
    }

    const messages = conversationHistory.get(chatId);
    messages.push({
      user: userText,
      bot: botResponse,
      timestamp: new Date().toISOString(),
    });

    // Mantener solo los últimos N mensajes
    if (messages.length > MAX_HISTORY_MESSAGES) {
      const removed = messages.shift(); // Eliminar el más antiguo
      console.log(`   ⚠️ Historial lleno, eliminando mensaje más antiguo (${messages.length - MAX_HISTORY_MESSAGES + 1} mensajes guardados)`);
    }

    conversationHistory.set(chatId, messages);
    
    // Guardar en Vercel KV si está disponible (no bloquear si falla)
    if (kv && chatId) {
      saveHistoryToKV(chatId, messages).catch(err => {
        console.warn(`⚠️ Error al guardar historial en KV (continuando sin KV):`, err.message);
        // No re-lanzar el error para que no interrumpa el flujo
      });
    }
    
    console.log(`   ✅ Mensaje guardado. Total mensajes en historial: ${messages.length}`);
  } catch (error) {
    console.error("❌ Error al guardar mensaje en historial:", error);
    console.error(error.stack);
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
// Funciones: Sistema de memoria con resúmenes y categorías
// ========================

/**
 * Genera un resumen de una conversación usando OpenAI
 */
async function generateConversationSummary(messages) {
  try {
    const conversationText = messages
      .map(msg => `Usuario: ${msg.user}\nBot: ${msg.bot}`)
      .join('\n\n');

    const config = await getBotConfig();
    
    const summaryPrompt = `Analiza la siguiente conversación y crea un resumen conciso (2-3 frases) que capture:
1. El estado emocional de Patri
2. Los temas principales discutidos
3. Cualquier progreso o dificultad mencionada

Conversación:
${conversationText}

Resumen:`;

    const completion = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: config.model,
        messages: [
          { role: "system", content: "Eres un asistente que resume conversaciones terapéuticas de forma concisa." },
          { role: "user", content: summaryPrompt }
        ],
        max_tokens: 150,
        temperature: 0.5,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return completion.data.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error al generar resumen:", error);
    return null;
  }
}

/**
 * Categoriza una conversación usando OpenAI
 */
async function categorizeConversation(messages) {
  try {
    const conversationText = messages
      .slice(-5) // Solo últimos 5 mensajes para categorizar
      .map(msg => `Usuario: ${msg.user}`)
      .join('\n');

    const config = await getBotConfig();
    
    const categoryPrompt = `Analiza los siguientes mensajes y clasifica la conversación en UNA de estas categorías:
- Ansiedad y estrés
- Tristeza y depresión
- Cansancio y fatiga
- Autoestima y autoconfianza
- Dolor físico
- Ejercicios y técnicas
- Celebración y avances
- Otros

Mensajes recientes:
${conversationText}

Responde SOLO con el nombre de la categoría:`;

    const completion = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: config.model,
        messages: [
          { role: "system", content: "Eres un clasificador de conversaciones terapéuticas." },
          { role: "user", content: categoryPrompt }
        ],
        max_tokens: 50,
        temperature: 0.3,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const category = completion.data.choices[0].message.content.trim();
    console.log(`📁 Conversación categorizada como: ${category}`);
    return category;
  } catch (error) {
    console.error("Error al categorizar conversación:", error);
    return "Otros";
  }
}

/**
 * Guarda un resumen categorizado de la conversación
 */
async function saveConversationSummary(chatId, messages) {
  try {
    if (messages.length < 5) return; // No generar resumen si hay pocos mensajes

    // Categorizar la conversación
    const category = await categorizeConversation(messages);
    
    // Generar resumen
    const summary = await generateConversationSummary(messages);
    if (!summary) return;

    // Inicializar estructura de resúmenes si no existe
    if (!conversationSummaries.has(chatId)) {
      conversationSummaries.set(chatId, {});
    }

    const summaries = conversationSummaries.get(chatId);
    
    // Inicializar categoría si no existe
    if (!summaries[category]) {
      summaries[category] = [];
    }

    // Añadir resumen
    summaries[category].push({
      summary,
      timestamp: new Date().toISOString(),
      messageCount: messages.length
    });

    // Mantener solo los últimos N resúmenes por categoría
    if (summaries[category].length > MAX_SUMMARIES_PER_CATEGORY) {
      summaries[category].shift();
    }

    conversationSummaries.set(chatId, summaries);
    
    // Intentar guardar en Vercel KV si está disponible
    if (kv) {
      try {
        await kv.set(`conversation:summaries:${chatId}`, summaries);
        console.log(`✅ Resumen guardado en KV para categoría: ${category}`);
      } catch (kvError) {
        console.error("Error al guardar en KV:", kvError);
      }
    }

    console.log(`📝 Resumen generado para categoría "${category}": ${summary.substring(0, 50)}...`);
  } catch (error) {
    console.error("Error al guardar resumen de conversación:", error);
  }
}

/**
 * Recupera los resúmenes de conversaciones por categoría
 */
function getConversationSummaries(chatId) {
  try {
    return conversationSummaries.get(chatId) || {};
  } catch (error) {
    console.error("Error al recuperar resúmenes:", error);
    return {};
  }
}

/**
 * Carga resúmenes desde Vercel KV si están disponibles
 */
async function loadSummariesFromKV(chatId) {
  if (!kv) return;
  
  try {
    const summaries = await kv.get(`conversation:summaries:${chatId}`);
    if (summaries) {
      conversationSummaries.set(chatId, summaries);
      console.log(`✅ Resúmenes cargados desde KV para chat ${chatId}`);
    }
    
    // Cargar también el contador de último resumen
    const lastCount = await kv.get(`conversation:summary_count:${chatId}`);
    if (lastCount !== null) {
      lastSummaryCount.set(chatId, lastCount);
      console.log(`✅ Contador de resúmenes cargado: ${lastCount}`);
    }
  } catch (error) {
    console.error("Error al cargar resúmenes desde KV:", error);
  }
}

/**
 * Guarda el historial de conversación en Vercel KV si está disponible
 */
async function saveHistoryToKV(chatId, messages) {
  if (!kv || !chatId || !messages) {
    console.log(`ℹ️ Saltando guardado en KV: kv=${!!kv}, chatId=${!!chatId}, messages=${!!messages}`);
    return;
  }
  
  try {
    // Validar que chatId sea un número o string válido
    const chatIdStr = String(chatId);
    if (!chatIdStr || chatIdStr === 'undefined' || chatIdStr === 'null') {
      console.warn(`⚠️ Chat ID inválido para guardar en KV: ${chatId}`);
      return;
    }
    
    // Validar que messages sea un array
    if (!Array.isArray(messages)) {
      console.warn(`⚠️ Messages no es un array válido para guardar en KV`);
      return;
    }
    
    await kv.set(`conversation:history:${chatIdStr}`, messages);
    console.log(`✅ Historial guardado en KV para chat ${chatIdStr} (${messages.length} mensajes)`);
  } catch (error) {
    console.error("Error al guardar historial en KV:", error.message || error);
    // No re-lanzar el error para que no interrumpa el flujo principal
  }
}

/**
 * Carga el historial de conversación desde Vercel KV si está disponible
 */
async function loadHistoryFromKV(chatId) {
  if (!kv || !chatId) return;
  
  try {
    // Validar que chatId sea válido
    const chatIdStr = String(chatId);
    if (!chatIdStr || chatIdStr === 'undefined' || chatIdStr === 'null') {
      console.warn(`⚠️ Chat ID inválido para cargar desde KV: ${chatId}`);
      return;
    }
    
    const history = await kv.get(`conversation:history:${chatIdStr}`);
    if (history && Array.isArray(history) && history.length > 0) {
      conversationHistory.set(chatId, history);
      console.log(`✅ Historial cargado desde KV para chat ${chatIdStr} (${history.length} mensajes)`);
    }
  } catch (error) {
    console.error("Error al cargar historial desde KV:", error.message || error);
    // No re-lanzar el error, continuar sin historial de KV
  }
}

/**
 * Formatea los resúmenes para incluir en el contexto del bot
 */
function formatSummariesForContext(summaries) {
  if (!summaries || Object.keys(summaries).length === 0) {
    return "";
  }

  const categories = Object.keys(summaries);
  const formattedText = categories.map(category => {
    const categorySummaries = summaries[category];
    const summaryList = categorySummaries
      .map(s => `  - ${s.summary} (${new Date(s.timestamp).toLocaleDateString('es-ES')})`)
      .join('\n');
    return `${category}:\n${summaryList}`;
  }).join('\n\n');

  return `\n\n📚 MEMORIA DE CONVERSACIONES ANTERIORES (por categorías):\n${formattedText}\n`;
}

// ========================
// Sistema de Historial Clínico (como un psicólogo real)
// ========================

/**
 * Genera una nota clínica profesional de la sesión/conversación
 */
async function generateClinicalNote(chatId, messages) {
  try {
    if (messages.length < 5) return null;

    const config = await getBotConfig();
    
    // Obtener resúmenes previos para contexto
    const summaries = getConversationSummaries(chatId);
    const previousContext = summaries && Object.keys(summaries).length > 0 
      ? formatSummariesForContext(summaries) 
      : "Primera conversación o sin historial previo.";

    const conversationText = messages
      .map(msg => `Usuario: ${msg.user}\nBot: ${msg.bot}`)
      .join('\n\n');

    const clinicalNotePrompt = `Eres un psicólogo profesional escribiendo una nota clínica sobre una sesión con Patri.

Contexto histórico de conversaciones anteriores:
${previousContext}

Analiza la siguiente conversación y crea una nota clínica profesional con esta estructura:

FECHA: [fecha de la conversación]
SESIÓN: [número de sesión aproximado]

AUTORREPORTE DE LA PACIENTE:
- Describe brevemente qué compartió Patri sobre su estado emocional, físico y mental
- Menciona preocupaciones principales o temas relevantes
- Incluye síntomas mencionados (ansiedad, tristeza, fatiga, dolor, etc.)

INTERVENCIONES REALIZADAS:
- Describe las técnicas o ejercicios propuestos
- Menciona las estrategias de apoyo ofrecidas
- Indica si hubo validación emocional, ejercicios de mindfulness, etc.

OBSERVACIONES TERAPÉUTICAS:
- Evalúa el progreso o retrocesos observados
- Señala patrones emocionales o conductuales
- Nota la capacidad de la paciente para regular sus emociones

FORTALEZAS IDENTIFICADAS:
- Menciona recursos internos que Patri demostró
- Destaca avances o logros mencionados
- Valora su capacidad de autoconocimiento

RECOMENDACIONES PARA PROXIMAS SESIONES:
- Sugiere temas a profundizar
- Indica técnicas que podrían ser útiles
- Menciona áreas de crecimiento potencial

Conversación a analizar:
${conversationText}

NOTA CLÍNICA:`;

    const completion = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: config.model,
        messages: [
          { 
            role: "system", 
            content: "Eres un psicólogo profesional que escribe notas clínicas detalladas y profesionales para seguimiento terapéutico. Sé objetivo, empático y profesional." 
          },
          { role: "user", content: clinicalNotePrompt }
        ],
        max_tokens: 800,
        temperature: 0.5,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const clinicalNote = completion.data.choices[0].message.content.trim();
    console.log(`📋 Nota clínica generada exitosamente`);
    return clinicalNote;
  } catch (error) {
    console.error("Error al generar nota clínica:", error);
    return null;
  }
}

/**
 * Guarda una nota clínica en el historial
 */
async function saveClinicalNote(chatId, clinicalNote) {
  try {
    if (!clinicalNote) {
      console.warn("⚠️ Intento de guardar nota clínica vacía, cancelado");
      return;
    }

    console.log(`💾 Guardando nota clínica para Chat ID: ${chatId}`);
    console.log(`   Nota: ${clinicalNote.substring(0, 100)}...`);

    // Inicializar historial clínico si no existe
    if (!clinicalHistory.has(chatId)) {
      clinicalHistory.set(chatId, []);
      console.log(`   ✅ Nuevo historial clínico creado para Chat ID: ${chatId}`);
    }

    const history = clinicalHistory.get(chatId);
    const messages = getHistory(chatId);
    
    // Calcular número de sesión
    const sessionNumber = history.length + 1;
    
    // Añadir nota clínica
    const newNote = {
      note: clinicalNote,
      timestamp: new Date().toISOString(),
      sessionNumber: sessionNumber,
      messageCount: messages.length
    };
    
    history.push(newNote);
    clinicalHistory.set(chatId, history);
    
    console.log(`   ✅ Nota clínica añadida al historial. Total notas: ${history.length}`);
    console.log(`   📝 Sesión ${sessionNumber}, Mensajes: ${messages.length}`);
    
    // Intentar guardar en Vercel KV si está disponible (no bloqueante)
    if (kv) {
      try {
        await kv.set(`clinical:history:${chatId}`, history);
        console.log(`   ✅ Nota clínica guardada en Vercel KV`);
      } catch (kvError) {
        console.error("   ⚠️ Error al guardar nota clínica en KV (continuando sin KV):", kvError.message);
        // No lanzar error, continuar sin KV
      }
    } else {
      console.warn("   ⚠️ Vercel KV no disponible, nota guardada solo en memoria");
      console.warn("   La nota se perderá al reiniciar el servidor si no hay KV configurado");
    }
    
    return newNote;
  } catch (error) {
    console.error("❌ Error al guardar nota clínica:", error);
    console.error("Stack:", error.stack);
    throw error;
  }
}

/**
 * Recupera el historial clínico completo
 */
function getClinicalHistory(chatId) {
  try {
    return clinicalHistory.get(chatId) || [];
  } catch (error) {
    console.error("Error al recuperar historial clínico:", error);
    return [];
  }
}

/**
 * Carga historial clínico desde Vercel KV si está disponible
 */
async function loadClinicalHistoryFromKV(chatId) {
  if (!kv) return;
  
  try {
    const history = await kv.get(`clinical:history:${chatId}`);
    if (history && Array.isArray(history) && history.length > 0) {
      clinicalHistory.set(chatId, history);
      console.log(`✅ Historial clínico cargado desde KV: ${history.length} notas`);
    }
  } catch (error) {
    console.error("Error al cargar historial clínico desde KV:", error);
  }
}

/**
 * Formatea el historial clínico para visualización
 */
function formatClinicalHistoryForDisplay(history) {
  if (!history || history.length === 0) {
    return "# Sin notas clínicas registradas aún.\n\nEl bot generará notas clínicas periódicamente durante las conversaciones.";
  }

  const formattedNotes = history.map((note, index) => {
    return `---\n\n## Sesión ${note.sessionNumber}\n**Fecha:** ${new Date(note.timestamp).toLocaleString('es-ES')}\n\n${note.note}\n`;
  }).join('\n');

  return `# Historial Clínico de Patri\n\n**Total de sesiones registradas:** ${history.length}\n\n**Última actualización:** ${new Date().toLocaleString('es-ES')}\n\n${formattedNotes}`;
}

// ========================
// Exportar para Vercel
// ========================
console.log("🚀 Aplicación iniciada - Rutas registradas:");
console.log("  ✓ GET /");
console.log("  ✓ GET /health");
console.log("  ✓ GET /test-admin");
console.log("  ✓ GET /admin");
console.log("  ✓ GET /historial");
console.log("  ✓ GET /api/config");
console.log("  ✓ POST /api/config");
console.log("  ✓ POST /api/auth");
console.log("  ✓ GET /api/summaries/:chatId");
console.log("  ✓ GET /api/clinical-history/:chatId");
console.log("  ✓ GET /api/clinical-history/:chatId/markdown");
console.log("  ✓ POST /webhook");

// Exportar app para uso en Vercel Serverless Functions
module.exports = app;

// Para desarrollo local SOLO si se ejecuta directamente (no cuando se importa)
if (require.main === module && !process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🤖 Bot corriendo en http://localhost:${PORT}`);
  });
}

