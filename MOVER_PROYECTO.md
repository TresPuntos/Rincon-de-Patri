# 🚀 Instrucciones para mover el proyecto a otra ubicación

## 📍 Ubicación Actual
```
/Users/jordi/Documents/GitHub/El rincon de Patri
```

## 🔗 Repositorio GitHub
```
https://github.com/TresPuntos/Rincon-de-Patri.git
```

## 📦 Opción 1: Clonar el repositorio en la nueva ubicación

Si quieres trabajar en otra carpeta, clona el repositorio:

```bash
# Ir a la nueva ubicación donde quieres el proyecto
cd /ruta/a/tu/nueva/ubicacion

# Clonar el repositorio
git clone https://github.com/TresPuntos/Rincon-de-Patri.git

# Entrar al proyecto
cd Rincon-de-Patri

# Instalar dependencias
npm install
```

## 📦 Opción 2: Copiar el proyecto completo

```bash
# Copiar toda la carpeta (excepto node_modules)
cp -R "/Users/jordi/Documents/GitHub/El rincon de Patri" "/nueva/ubicacion/"

# Ir a la nueva ubicación
cd "/nueva/ubicacion/El rincon de Patri"

# Inicializar git si es necesario
git init
git remote add origin https://github.com/TresPuntos/Rincon-de-Patri.git
git pull origin main

# Instalar dependencias
npm install
```

## 📁 Archivos Importantes que DEBEN estar presentes:

✅ `api/index.js` - Handler de Vercel (CRÍTICO)
✅ `vercel.json` - Configuración de Vercel (CRÍTICO)
✅ `index.js` - Aplicación principal
✅ `package.json` - Dependencias
✅ `Bot_Patri_Instrucciones/` - Carpeta con PDFs

## 🔍 Verificar que todo está correcto:

```bash
# Verificar estructura
ls -la api/
ls -la Bot_Patri_Instrucciones/

# Verificar git
git remote -v
git status

# Verificar dependencias
npm list --depth=0
```

## ⚙️ Variables de Entorno necesarias:

Asegúrate de tener estas variables configuradas en Vercel:
- `TELEGRAM_TOKEN`
- `OPENAI_API_KEY`
- `ADMIN_PASSWORD` (opcional, por defecto: admin123)

