# Bot Psicólogo Virtual para Telegram 🤖💬

Bot de psicólogo virtual para Telegram usando OpenAI GPT-3.5-turbo, desplegado en Vercel.

## 🚀 Características

- ✅ Integración con Telegram Bot API
- ✅ Respuestas inteligentes usando OpenAI GPT-3.5-turbo
- ✅ **Historial de conversación ampliado (50 mensajes)**
- ✅ **Sistema de memoria inteligente con resúmenes automáticos**
- ✅ **Categorización automática de conversaciones**
- ✅ **Historial clínico profesional** (como un psicólogo real)
- ✅ **Generación automática de notas clínicas**
- ✅ **Memoria persistente con Vercel KV**
- ✅ Manejo de errores robusto
- ✅ Panel de administración completo con visor de historial
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
├── public/           # Archivos estáticos
│   └── admin.html    # Panel de administración
├── .env.example      # Template de variables de entorno
└── README.md         # Este archivo
```

## 🔍 Endpoints

- `GET /` - Health check básico
- `GET /health` - Health check alternativo
- `POST /webhook` - Endpoint para recibir mensajes de Telegram
- `GET /admin` - Panel de administración completo
- `GET /historial-clinico` - Vista dedicada del historial clínico de Patri
- `GET /api/config` - Obtener configuración del bot (requiere autenticación)
- `POST /api/config` - Guardar configuración del bot (requiere autenticación)
- `POST /api/auth` - Autenticación para el panel de administración
- `GET /api/summaries/:chatId` - Ver resúmenes de conversación por categorías (requiere autenticación)
- `GET /api/clinical-history/:chatId` - Ver historial clínico completo de Patri (requiere autenticación)
- `GET /api/clinical-history/:chatId/markdown` - Descargar historial clínico en formato Markdown (requiere autenticación)
- `GET /api/documents` - Listar documentos (requiere autenticación)
- `POST /api/documents` - Subir documento (requiere autenticación)
- `DELETE /api/documents/:path` - Eliminar documento (requiere autenticación)

## 💾 Almacenamiento y Sistema de Memoria

El bot incluye un **sistema de memoria inteligente** con las siguientes características:

### Historial de Conversación
- **Últimos 50 mensajes** se mantienen en memoria para contexto inmediato
- Funciona sin configuración adicional en memoria local
- Con Vercel KV, persiste entre sesiones
- Aumentado para proporcionar más contexto al bot

### Sistema de Resúmenes Automáticos 🧠
El bot genera automáticamente **resúmenes de conversaciones** cada 10 mensajes:

- **Generación automática**: El bot analiza la conversación y crea resúmenes concisos (2-3 frases)
- **Categorización inteligente**: Las conversaciones se clasifican en categorías:
  - Ansiedad y estrés
  - Tristeza y depresión
  - Cansancio y fatiga
  - Autoestima y autoconfianza
  - Dolor físico
  - Ejercicios y técnicas
  - Celebración y avances
  - Otros

### Memoria Persistente con Vercel KV (Recomendado) 💾

El sistema está optimizado para usar Vercel KV automáticamente si está disponible:

1. **Añade Vercel KV** a tu proyecto en el dashboard de Vercel:
   - Settings → Storage → Create Database → Vercel KV
   - Se añade automáticamente como variable de entorno

2. **Beneficios**:
   - ✅ Los resúmenes persisten entre sesiones
   - ✅ El bot recuerda conversaciones anteriores
   - ✅ Se mantiene la categorización histórica
   - ✅ Funciona sin configuración adicional en el código

3. **Sin Vercel KV**: El sistema funciona en memoria, pero los resúmenes se reinician con cada deploy

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
4. **Ver historial clínico de Patri** - Consulta todas las notas clínicas generadas
5. **Descargar historial clínico** - Exporta el historial completo en formato Markdown
6. **Subir documentos** - Comparte documentos que el bot puede usar como referencia

**Para acceder al historial clínico:**

1. Ve a `https://tu-proyecto.vercel.app/historial-clinico` (vista dedicada)
   - O también: `https://tu-proyecto.vercel.app/admin` (panel completo)
2. Ingresa la contraseña (por defecto: `admin123`)
3. Introduce el Chat ID de Patri
4. Haz clic en "Ver Historial Clínico"
5. Descarga el historial en Markdown si lo necesitas

**Nota:** Configura la variable de entorno `ADMIN_PASSWORD` en Vercel para cambiar la contraseña

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

## 🧠 Cómo Funciona el Sistema de Memoria

El bot utiliza un sistema de **memoria en capas** para mantener el contexto y proporcionar respuestas personalizadas:

### Capa 1: Historial Reciente (50 mensajes)
- Mantiene los últimos 50 intercambios usuario-bot
- Se usa para contexto inmediato en la conversación
- Se pierde al reiniciar si no hay Vercel KV

### Capa 2: Resúmenes Categorizados
- Cada 10 mensajes, el bot genera automáticamente un resumen
- El resumen captura:
  - Estado emocional de Patri
  - Temas principales discutidos
  - Progreso o dificultades
- Cada resumen se clasifica en una categoría emocional
- Se mantienen hasta 5 resúmenes por categoría

### Capa 3: Contexto Compartido
- Al generar una respuesta, el bot incluye:
  - Resúmenes relevantes por categoría
  - Fechas de las conversaciones anteriores
  - Información contextual para personalización

**Ejemplo de memoria activa:**
```
📚 MEMORIA DE CONVERSACIONES ANTERIORES (por categorías):
Ansiedad y estrés:
  - Patri expresó preocupación sobre su capacidad para manejar situaciones sociales. Le propusimos técnicas de respiración que le ayudaron. (15/01/2024)
  - Mencionó sentirse abrumada por las tareas diarias. Trabajamos en organización y priorización. (20/01/2024)

Celebración y avances:
  - Patri compartió que logró mantener la calma durante una situación estresante. Mencionó sentirse orgullosa. (22/01/2024)
```

### Beneficios
- ✅ **Continuidad**: El bot recuerda temas y progreso anteriores
- ✅ **Personalización**: Respuestas adaptadas a la historia de Patri
- ✅ **Eficiencia**: Solo se almacenan resúmenes concisos
- ✅ **Organización**: Clasificación automática por emociones/temas

### Capa 4: Historial Clínico Profesional 🏥

El bot funciona como un psicólogo real, generando **notas clínicas profesionales** periódicamente:

- **Generación automática**: Cada 20 mensajes, el bot crea una nota clínica detallada
- **Estructura profesional**: Incluye:
  - Fecha y número de sesión
  - Autoreporte de la paciente
  - Intervenciones realizadas
  - Observaciones terapéuticas
  - Fortalezas identificadas
  - Recomendaciones para próximas sesiones
  
**Acceso al Historial Clínico:**

1. Desde el panel de administración (`/admin`)
2. Introduce el Chat ID de Patri
3. Haz clic en "Ver Historial Clínico"
4. Descarga como Markdown para archivo físico

**Ejemplo de nota clínica:**
```
FECHA: 23/01/2024
SESIÓN: 3

AUTORREPORTE DE LA PACIENTE:
Patri expresó sentirse abrumada por las tareas diarias y cansancio físico...
[toda la nota continua]
```

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

