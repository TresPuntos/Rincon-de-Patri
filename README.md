# Bot Psicólogo Virtual para Telegram 🤖💬

Bot de psicólogo virtual para Telegram usando OpenAI GPT-3.5-turbo, desplegado en Vercel.

## 🚀 Características

- ✅ Integración con Telegram Bot API
- ✅ Respuestas inteligentes usando OpenAI GPT-3.5-turbo
- ✅ Historial de conversación en memoria
- ✅ Manejo de errores robusto
- ✅ Desplegado en Vercel (serverless)
- ✅ Health check endpoints

## 📋 Requisitos Previos

1. **Cuenta de Telegram** - Para crear el bot con BotFather
2. **Cuenta de OpenAI** - Para obtener la API key
3. **Cuenta de Vercel** - Para el despliegue (gratis)
4. **Cuenta de GitHub** - Para conectar el repositorio

## 🔧 Configuración

### 1. Crear el Bot en Telegram

1. Abre Telegram y busca `@BotFather`
2. Ejecuta `/newbot` y sigue las instrucciones
3. Asigna un nombre al bot (ej: "PatriPsicobot")
4. Copia el **TOKEN** que te proporciona BotFather

### 2. Obtener API Key de OpenAI

1. Ve a https://platform.openai.com/api-keys
2. Crea una nueva API key
3. **Importante**: Asegúrate de tener créditos en tu cuenta de OpenAI

### 3. Configuración Local (Opcional)

1. Clona este repositorio
2. Instala las dependencias:
   ```bash
   npm install
   ```
3. Crea un archivo `.env` basado en `.env.example`:
   ```bash
   cp .env.example .env
   ```
4. Edita `.env` y añade tus tokens:
   ```
   TELEGRAM_TOKEN=tu_token_de_telegram
   OPENAI_API_KEY=tu_api_key_de_openai
   ```
5. Ejecuta localmente:
   ```bash
   npm start
   ```

### 4. Desplegar en Vercel

1. **Sube el proyecto a GitHub**
   - Crea un nuevo repositorio
   - Sube todos los archivos del proyecto

2. **Conecta con Vercel**
   - Ve a [vercel.com](https://vercel.com)
   - Conecta tu repositorio de GitHub
   - Vercel detectará automáticamente la configuración

3. **Configura Variables de Entorno en Vercel**
   - Ve a tu proyecto en Vercel
   - Settings → Environment Variables
   - Añade estas variables:
     - `TELEGRAM_TOKEN`: tu token de Telegram
     - `OPENAI_API_KEY`: tu API key de OpenAI
     - `ADMIN_PASSWORD`: contraseña para el panel de administración (opcional, por defecto: `admin123`)

4. **Obtén la URL de Vercel**
   - Una vez desplegado, Vercel te dará una URL como: `https://tu-proyecto.vercel.app`

5. **Configurar el Webhook de Telegram**
   - Ejecuta este comando (reemplaza `<TU_TOKEN>` y `<TU_URL_VERCEL>`):
   ```bash
   curl https://api.telegram.org/bot<TU_TOKEN>/setWebhook?url=https://<TU_URL_VERCEL>/webhook
   ```
   
   Ejemplo:
   ```bash
   curl https://api.telegram.org/bot1234567890:ABCdefGHIjklMNOpqrsTUVwxyz/setWebhook?url=https://bot-psicologo.vercel.app/webhook
   ```

6. **Verificar el Webhook**
   ```bash
   curl https://api.telegram.org/bot<TU_TOKEN>/getWebhookInfo
   ```

## 🧪 Probar el Bot

1. Busca tu bot en Telegram usando el nombre que le diste
2. Envía un mensaje de prueba
3. El bot debería responder con una respuesta del psicólogo virtual

## 📝 Estructura del Proyecto

```
.
├── index.js          # Código principal del bot
├── package.json      # Dependencias del proyecto
├── vercel.json       # Configuración de Vercel
├── .env.example      # Template de variables de entorno
└── README.md         # Este archivo
```

## 🔍 Endpoints

- `GET /` - Health check básico
- `GET /health` - Health check alternativo
- `POST /webhook` - Endpoint para recibir mensajes de Telegram
- `GET /admin` - Panel de administración
- `GET /api/config` - Obtener configuración del bot (requiere autenticación)
- `POST /api/config` - Guardar configuración del bot (requiere autenticación)
- `GET /api/documents` - Listar documentos (requiere autenticación)
- `POST /api/documents` - Subir documento (requiere autenticación)
- `DELETE /api/documents/:path` - Eliminar documento (requiere autenticación)

## 💾 Almacenamiento

Actualmente el bot usa **almacenamiento en memoria** para el historial de conversaciones. Esto significa que:
- ✅ Funciona sin configuración adicional
- ⚠️ El historial se pierde cuando Vercel hace un nuevo deploy
- ⚠️ El historial se reinicia periódicamente (Vercel tiene cold starts)

### Migrar a Vercel KV (Opcional, para persistencia)

Si necesitas persistencia permanente del historial, puedes usar Vercel KV (Redis):

1. Añade Vercel KV a tu proyecto en el dashboard de Vercel
2. Instala el paquete: `npm install @vercel/kv`
3. Reemplaza las funciones `saveMessage()` y `getHistory()` en `index.js` con:
   ```javascript
   const { kv } = require('@vercel/kv');
   
   async function saveMessage(chatId, userText, botResponse) {
     const key = `chat:${chatId}`;
     const messages = await kv.get(key) || [];
     messages.push({ user: userText, bot: botResponse, timestamp: new Date().toISOString() });
     if (messages.length > MAX_HISTORY_MESSAGES) {
       messages.shift();
     }
     await kv.set(key, messages);
   }
   
   async function getHistory(chatId) {
     const key = `chat:${chatId}`;
     return await kv.get(key) || [];
   }
   ```

## 🛠️ Personalización

### Cambiar el modelo de OpenAI

En `index.js`, línea donde se llama a la API, puedes cambiar:
```javascript
model: "gpt-3.5-turbo",  // Cambiar a "gpt-4" para respuestas más avanzadas
```

### Panel de Administración

El bot incluye un panel de administración completo donde puedes:

1. **Configurar el prompt del psicólogo** - Personaliza cómo se comporta el bot
2. **Cambiar el mensaje de bienvenida** - Personaliza el mensaje `/start`
3. **Ajustar parámetros de OpenAI** - Modelo, tokens, temperatura
4. **Subir documentos** - Comparte documentos que el bot puede usar como referencia

**Para acceder al panel:**

1. Ve a `https://tu-proyecto.vercel.app/admin`
2. Ingresa la contraseña (por defecto: `admin123`)
3. Configura la variable de entorno `ADMIN_PASSWORD` en Vercel para cambiar la contraseña

**Configurar Vercel KV y Blob Storage (Recomendado):**

Para que la configuración y documentos persistan:

1. **Vercel KV (para configuración):**
   - Ve a tu proyecto en Vercel Dashboard
   - Settings → Storage → Create Database → Vercel KV
   - Se añadirá automáticamente como variable de entorno

2. **Vercel Blob (para documentos):**
   - Ve a tu proyecto en Vercel Dashboard
   - Settings → Storage → Create Database → Vercel Blob
   - Se añadirá automáticamente como variable de entorno

**Nota:** Sin Vercel KV y Blob, el sistema funcionará en memoria (se reinicia con cada deploy).

## ⚠️ Notas Importantes

1. **Costos de OpenAI**: Cada mensaje consume tokens. Revisa tu uso en la dashboard de OpenAI.
2. **Límites de Telegram**: Telegram tiene límites de velocidad. Si recibes muchos mensajes, considera implementar rate limiting.
3. **Seguridad**: Nunca compartas tus tokens. Usa variables de entorno siempre.
4. **Cold Starts**: Vercel puede tener cold starts (primera petición lenta). Esto es normal en funciones serverless.

## 🐛 Troubleshooting

### El bot no responde
1. Verifica que el webhook esté configurado correctamente
2. Revisa los logs en Vercel Dashboard
3. Verifica que las variables de entorno estén configuradas

### Error de API Key
- Asegúrate de que `OPENAI_API_KEY` esté correctamente configurada
- Verifica que tengas créditos en tu cuenta de OpenAI

### Error de Token de Telegram
- Verifica que `TELEGRAM_TOKEN` sea correcto
- Asegúrate de que el bot esté activo en BotFather

## 📚 Recursos

- [Documentación de Telegram Bot API](https://core.telegram.org/bots/api)
- [Documentación de OpenAI API](https://platform.openai.com/docs)
- [Documentación de Vercel](https://vercel.com/docs)
- [Vercel KV (Redis)](https://vercel.com/docs/storage/vercel-kv)

## 📄 Licencia

MIT

---

Creado con ❤️ para ayudar a las personas a tener un espacio de apoyo emocional.

