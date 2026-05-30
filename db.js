import mysql from 'mysql2';

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.getConnection((err, connection) => {
    if(err){
        console.error("MySQL failed to connect", err.message);
    }else{
        console.log("Connection to MySQL successful");
        connection.release();
    }
});

export default db.promise();