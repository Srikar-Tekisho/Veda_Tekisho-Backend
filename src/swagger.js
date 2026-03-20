// src/swagger.js
import swaggerJsdoc from "swagger-jsdoc";

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Tekisho AI Backend API",
      version: "1.0.0",
      description: "API documentation for Tekisho AI chatbot backend",
    },
    servers: [
      {
        url: "http://localhost:5002",
        description: "Local server",
      },
    ],
  },
  apis: ["./src/controllers/*.js"], // IMPORTANT: scan all controllers
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

export default swaggerSpec;
