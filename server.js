import express from 'express';
import path from 'path';
import db from './db.js';
import bcrypt from 'bcrypt';
import { fileURLToPath } from 'url';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';


const app = express();
const port = process.env.PORT;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(cors());
app.use(express.static('public'));
app.use('/music', express.static(path.join(__dirname, 'music')));

function requireAdmin(req, res, next){
    const user = req.body.requestingUser || req.query.requestingUser;
    if(!user) return res.status(401).json({message: 'Not authenticated'});
    try{
        const parsed = typeof user === 'string' ? JSON.parse(user) : user;
        if(parsed.role !== 'admin') return res.status(403).json({message: 'Forbidden'});
        next();
    }
    catch{
        return res.status(500).json({message: 'Invalid data'})
    }
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null,'music/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
})

const upload = multer({storage: storage});

app.get('/api/songs', async (req, res) => {
    const userId = req.query.userId;

    try{
       const query = `SELECT s.*, IF(f.song_id IS NOT NULL, 1, 0) AS is_fav FROM songs s LEFT JOIN favorites f ON s.id = f.song_id AND f.user_id = ?`;
       const [songs] = await db.query(query, [userId]);
       res.json(songs);
    }catch(error){
        res.status(500).json({error: error.message});
    }
});

app.post('/api/register', async (req, res) => {
    const {username, password, adminKey} = req.body;
    let role = 'user';
    if(adminKey === process.env.adminKey){
        role = 'admin';
    }else{
        role = 'user';
    }

    try{
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const sql = 'INSERT INTO users (username, password_hash, role) VALUES(?,?,?)';
        await db.query(sql, [username, hashedPassword, role]);

        res.json({message: "Succesfully created!"});
    }catch(error){
        if(error.code === 'ER_DUP_ENTRY'){
            res.status(400).json({message: 'Login already taken'});
        }else{
            res.status(500).json({message: 'Server fail!'});
        }
    }
});

app.post('/api/login', async (req,res) => {
    const {username, password} = req.body;
    try{
        const [users] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        if(users.length === 0){
            return res.status(401).json({message: 'User was not found!'});
        }
        const user = users[0];
        
        const match = await bcrypt.compare(password, user.password_hash);
        if(match){
            res.json({message: 'Succesfully logged in!', user: {id:user.id, username: user.username, role: user.role}});
        }else{
            res.status(401).json({message: 'Password failed!'})
        }
    }catch(err){
        res.status(500).json({message: 'Server failed!'});
    }
});

app.post('/api/upload',requireAdmin, upload.single('file'), async (req, res) => {
    try{
        const {title, artist} = req.body;
        
        if(!title || !artist || !req.file){
            return res.status(400).json({message: "Missing data"});
        }
        const fileName = req.file.filename; 

        const sql = 'INSERT INTO songs (title, artist, file_path) VALUES (?, ?, ?)';
        await db.query(sql, [title, artist, fileName]);

        res.json({message: "Uploaded succesfully!"});
    }catch(err){
        console.error(err);
        res.status(500).json("Database error");
    }
});

app.get('/api/radio-stations', async (req, res) => {
    const url = 'https://50k-radio-stations.p.rapidapi.com/radios?genre_slug=rock&limit=20';
    const apiKey = process.env.apiKey;

    if(!apiKey){
        return res.status(500).json({message: "Missing API key!"});
    }

    try{
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'X-RapidAPI-Key': apiKey,
                'X-RapidAPI-Host': '50k-radio-stations.p.rapidapi.com'
            }
        });
        if(!response.ok){
            return res.status(response.status).json({message: "API responded with an error"});
        }

        const data = await response.json();

        res.json(data);
    }catch(error){
        console.error("API proxy error", error);
        res.status(500).json({message: "Server failed!"});
    }
});

app.post('/api/favorites/toggle', async (req, res) => {
    const {userId, songId} = req.body;

    if(!userId || !songId){
        return res.status(401).json({message: "Missing required data"});
    }

    try{
        const [existing] = await db.query("SELECT * FROM favorites WHERE user_id = ? AND song_id = ?", [userId, songId]);

        if(existing.length > 0){
            await db.query("DELETE FROM favorites WHERE user_id = ? AND song_id = ?", [userId, songId]);
            return res.json({isFavorited: false});
        }else{
            await db.query("INSERT INTO favorites (user_id, song_id) VALUES(?, ?)", [userId, songId]);
            return res.json({isFavorited: true});
        }
    }catch(err){
        console.error(err);
        res.status(500).json({message: "Database failed!"});
    }
});

app.get('/api/favorites/:userId', async (req, res) => {
    const {userId} = req.params;

    try{
        const [rows] = await db.query(`SELECT songs.*, 1 AS is_fav FROM songs INNER JOIN favorites ON songs.id = favorites.song_id WHERE favorites.user_id = ? ORDER BY favorites.created_at DESC`, [userId]);
        res.json(rows);
    }catch(err){
        console.error(err);
        res.status(500).json({message: "Database failed!"});
    }
});

app.get('/api/songs/search', async (req, res) => {
    const {query, userId} = req.query;

    if(!query){
        return res.json([]);
    }

    try{
        const sql = `SELECT s.*, IF(f.song_id IS NOT NULL, 1, 0) AS is_fav
                    FROM songs s
                    LEFT JOIN favorites f ON s.id = f.song_id AND f.user_id = ?
                    WHERE s.title LIKE ? OR s.artist LIKE ?`;
        const searchTerm = `%${query}%`;
        const [rows] = await db.query(sql, [userId, searchTerm, searchTerm]);
        res.json(rows);
    }catch(err){
        console.error(err);
        res.status(500).json({message: "Database fail"})
    }
});

app.put('/api/songs/:id', requireAdmin, async (req, res) => {
    const songId = req.params.id;
    const {title, artist} = req.body;

    if(!title || !artist){
        return res.status(400).json({message: "Title and Artist fields can not be emty."});
    };

    try{
        const sql = 'UPDATE songs SET title = ?, artist = ? WHERE id = ?';
        const [result] = await db.query(sql, [title, artist, songId]);

        if(result.affectedRows === 0){
            return res.status(404).json({message: "Song not found in the DB."});
        }

        return res.json({message: "Song renamed succesfully!"});
    }catch(err){
        console.error(err);
        return res.status(500).json({message: "Server failed!"});
    }
});

app.delete('/api/songs/:id', requireAdmin, async (req, res) => {
    const songId = req.params.id;

    try{
        const [songs] = await db.query("SELECT file_path FROM songs WHERE id=?", [songId]);

        if(songs.length === 0){
            return res.status(404).json({message: "Song's not found"});
        }

        const fileName = songs[0].file_path;
        await db.query('DELETE FROM songs WHERE id = ?', [songId]);
        const absolutePath = path.join(__dirname, 'music', fileName);
        
        fs.unlink(absolutePath, (err) => {
            if(err){
                console.warn(`Could not find the or delete the file on disk at ${absolutePath}`);
            }else{
                console.log(`${fileName} is succesfully deleted`);
            }
        });
        return res.json({message: "Song is succesfully deleted"});
    }catch(err){
        console.error(err);
        return res.status(500).json({message: "Server failed!"});
    }
});

app.listen(port, () => {
    console.log(`Server is running: http://localhost:${port}`);
});
