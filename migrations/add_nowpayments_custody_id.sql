-- Migración para agregar columna nowpayments_custody_id a la tabla users
-- Ejecutar este script en tu servidor de base de datos MySQL

ALTER TABLE users ADD COLUMN nowpayments_custody_id VARCHAR(50) NULL;

-- Crear índice para mejorar el rendimiento de consultas
CREATE INDEX idx_users_nowpayments_custody_id ON users(nowpayments_custody_id);

-- Comentario para documentar la columna
ALTER TABLE users MODIFY COLUMN nowpayments_custody_id VARCHAR(50) NULL COMMENT 'ID del subuser custody en NOWPayments';


