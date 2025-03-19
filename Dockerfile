# Usa la imagen de Node.js
FROM node:18

# Establece el directorio de trabajo
WORKDIR /app

# Copia los archivos y paquetes
COPY package*.json ./
RUN npm install

# Copia el código de la aplicación
COPY . .

# Expone el puerto
EXPOSE 8080

# Comando para iniciar la app
CMD ["npm", "start"]
