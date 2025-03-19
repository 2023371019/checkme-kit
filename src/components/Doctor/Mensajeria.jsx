import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";

const Mensajeria = () => {
  const [messages, setMessages] = useState([]);  // Estado para los mensajes recibidos
  const [newMessage, setNewMessage] = useState("");  // Estado para el nuevo mensaje a enviar
  const socket = io("http://localhost:5000");  // Conexión con el servidor de Socket.io

  // Uso de useEffect para establecer la conexión a Socket.io
  useEffect(() => {
    // Escuchar los mensajes recibidos desde el servidor
    socket.on("mensaje-recibido", (message) => {
      setMessages((prevMessages) => [...prevMessages, message]);  // Agregar el mensaje al estado
    });

    // Limpiar la conexión cuando el componente se desmonte
    return () => {
      socket.off("mensaje-recibido");
    };
  }, []);

  // Función para manejar el envío de mensajes
  const handleSendMessage = () => {
    if (newMessage.trim()) {  // Si el mensaje no está vacío
      const messageData = {
        mensaje: newMessage,  // Solo pasamos el contenido del mensaje
      };

      // Emitir el mensaje al servidor
      socket.emit("enviar-mensaje", messageData);

      // Limpiar el campo de texto después de enviar el mensaje
      setNewMessage("");
    }
  };

  return (
    <div>
      <h2>Chat en tiempo real</h2>
      <div>
        {/* Mostrar todos los mensajes recibidos */}
        {messages.map((msg, index) => (
          <div key={index}>
            <p>{msg.mensaje}</p>  {/* Solo se muestra el contenido del mensaje */}
          </div>
        ))}
      </div>
      {/* Campo de entrada para escribir un nuevo mensaje */}
      <input
        type="text"
        value={newMessage}
        onChange={(e) => setNewMessage(e.target.value)}  // Actualizar el estado al escribir
        placeholder="Escribe un mensaje"
      />
      {/* Botón para enviar el mensaje */}
      <button onClick={handleSendMessage}>Enviar</button>
    </div>
  );
};

export default Mensajeria;
