const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const serverless = require('serverless-http');

const app = express();
const ITEMS_PER_PAGE = 5;

// Middleware untuk parsing body
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Fungsi untuk memproses dan menyederhanakan data
function simplifyData(data) {
    const episodeMap = new Map();

    data.forEach(item => {
        // Ekstrak slug dari episode_link
        const slugMatch = item.episode_link.match(/episode\/(.+?)\//);
        const slug = slugMatch ? slugMatch[1] : '';

        // Ekstrak nomor episode
        const episodeMatch = item.episode_title.match(/Episode (\d+)/i);
        const episodeNumber = episodeMatch ? parseInt(episodeMatch[1]) : 0;

        // Buat key unik berdasarkan anime_title + episode_title
        const key = `${item.anime_title}-${item.episode_title}`;

        if (!episodeMap.has(key)) {
            episodeMap.set(key, {
                id: item.decoded_data.id,
                title: item.anime_title,
                episode: item.episode_title.replace(item.anime_title, '').trim(),
                episodeNumber: episodeNumber,
                slug: slug,
                date: item.episode_date,
                code: item.decoded_data,
                servers: [],
                timestamp: item.timestamp
            });
        }

        // Tambahkan server info
        episodeMap.get(key).servers.push({
            server: item.server,
            quality: item.quality,
            embed: item.stream_url,
            default: item.is_default || false
        });
    });

    return Array.from(episodeMap.values());
}

// Path untuk folder stream (disesuaikan untuk Netlify)
const STREAM_DIR = process.env.NODE_ENV === 'production' 
  ? path.join(process.cwd(), 'stream')
  : './stream';

// Fungsi untuk membaca semua file JSON
async function getAllJSONFiles() {
    try {
        const files = await fs.readdir(STREAM_DIR);
        const jsonFiles = files.filter(file => 
            file.match(/^\d{9}\.json$/) && file !== '.gitkeep'
        ).sort();

        const allData = [];
        
        for (const file of jsonFiles) {
            try {
                const filePath = path.join(STREAM_DIR, file);
                const fileContent = await fs.readFile(filePath, 'utf8');
                const jsonData = JSON.parse(fileContent);
                
                if (Array.isArray(jsonData)) {
                    allData.push(...jsonData);
                } else {
                    allData.push(jsonData);
                }
            } catch (error) {
                console.error(`Error reading file ${file}:`, error.message);
            }
        }

        return simplifyData(allData);
        
    } catch (error) {
        console.error('Error reading directory:', error.message);
        throw new Error('Failed to read JSON files directory');
    }
}

// Fungsi untuk mendapatkan data berdasarkan ID atau slug
async function getEpisodeByIdOrSlug(identifier) {
    const allData = await getAllJSONFiles();
    
    // Cari berdasarkan ID
    let episode = allData.find(item => item.id.toString() === identifier);
    
    // Jika tidak ditemukan berdasarkan ID, cari berdasarkan slug
    if (!episode) {
        episode = allData.find(item => item.slug === identifier);
    }
    
    return episode;
}

// Fungsi untuk mendapatkan navigasi next/prev
async function getNavigation(episode) {
    const allData = await getAllJSONFiles();
    
    // Kelompokkan berdasarkan title anime
    const animeGroups = {};
    allData.forEach(item => {
        if (!animeGroups[item.title]) {
            animeGroups[item.title] = [];
        }
        animeGroups[item.title].push(item);
    });
    
    // Urutkan episode dalam setiap grup anime berdasarkan episodeNumber
    Object.keys(animeGroups).forEach(title => {
        animeGroups[title].sort((a, b) => a.episodeNumber - b.episodeNumber);
    });
    
    // Cari episode saat ini dalam grupnya
    const currentAnimeEpisodes = animeGroups[episode.title] || [];
    const currentIndex = currentAnimeEpisodes.findIndex(e => e.id === episode.id);
    
    let prevEpisode = null;
    let nextEpisode = null;
    
    if (currentIndex > 0) {
        prevEpisode = currentAnimeEpisodes[currentIndex - 1];
    }
    
    if (currentIndex < currentAnimeEpisodes.length - 1) {
        nextEpisode = currentAnimeEpisodes[currentIndex + 1];
    }
    
    return { prevEpisode, nextEpisode };
}

// Endpoint utama dengan pagination
app.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.s) || 1;
        const play = req.query.play;
        
        // Jika ada parameter play, redirect ke halaman player
        if (play) {
            return res.redirect(`/.netlify/functions/server/play?episode=${play}`);
        }

        if (isNaN(page) || page < 1) {
            return res.status(400).json({
                error: 'Invalid page number. Page must be a positive integer.'
            });
        }

        const allData = await getAllJSONFiles();
        const totalItems = allData.length;
        const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
        
        const currentPage = Math.max(1, Math.min(page, totalPages));
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        const endIndex = startIndex + ITEMS_PER_PAGE;
        const paginatedData = allData.slice(startIndex, endIndex);

        // Serve HTML page dengan data
        res.send(`
            <!DOCTYPE html>
            <html lang="id">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Anime Stream API</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; background: #f4f4f4; }
                    .container { max-width: 1200px; margin: 0 auto; }
                    .episode-card { background: white; padding: 20px; margin: 10px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                    .episode-title { font-size: 18px; font-weight: bold; margin-bottom: 10px; }
                    .watch-btn { background: #007bff; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px; margin-right: 10px; }
                    .pagination { margin-top: 20px; }
                    .page-btn { padding: 8px 16px; margin: 0 5px; background: #007bff; color: white; text-decoration: none; border-radius: 4px; }
                    .disabled { background: #ccc; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Daftar Episode Anime</h1>
                    
                    ${paginatedData.map(episode => `
                        <div class="episode-card">
                            <div class="episode-title">${episode.title} - ${episode.episode}</div>
                            <div>Tanggal: ${episode.date}</div>
                            <div>Servers: ${episode.servers.length} server available</div>
                            <a href="/play?episode=${episode.slug}" class="watch-btn">Watch Now</a>
                            <a href="/play?episode=${episode.id}" class="watch-btn">Watch by ID</a>
                        </div>
                    `).join('')}
                    
                    <div class="pagination">
                        ${currentPage > 1 ? `<a href="/?s=${currentPage - 1}" class="page-btn">Previous</a>` : '<span class="page-btn disabled">Previous</span>'}
                        <span>Page ${currentPage} of ${totalPages}</span>
                        ${currentPage < totalPages ? `<a href="/?s=${currentPage + 1}" class="page-btn">Next</a>` : '<span class="page-btn disabled">Next</span>'}
                    </div>
                </div>
            </body>
            </html>
        `);
        
    } catch (error) {
        console.error('Server error:', error.message);
        res.status(500).send('Internal server error');
    }
});

// Endpoint player video dengan UI dari gg.html
app.get('/play', async (req, res) => {
    try {
        const episodeIdentifier = req.query.episode;
        
        if (!episodeIdentifier) {
            return res.redirect('/.netlify/functions/server/');
        }

        const episode = await getEpisodeByIdOrSlug(episodeIdentifier);
        
        if (!episode) {
            return res.status(404).send('Episode not found');
        }

        const { prevEpisode, nextEpisode } = await getNavigation(episode);
        const defaultServer = episode.servers.find(server => server.default) || episode.servers[0];

        // HTML template dengan integrasi fitur dari gg.html
        res.send(`
            <!DOCTYPE html>
            <html lang="id">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${episode.title} - ${episode.episode}</title>
                <style>
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    }
                    
                    body {
                        background-color: #0a0a1a;
                        color: #fff;
                        overflow: hidden;
                    }
                    
                    .container {
                        position: relative;
                        width: 100%;
                        height: 100vh;
                        display: flex;
                        flex-direction: column;
                    }
                    
                    .video-wrapper {
                        position: relative;
                        flex: 1;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        overflow: hidden;
                    }
                    
                    .video-container {
                        position: relative;
                        width: 100%;
                        height: 100%;
                    }
                    
                    .video-container iframe {
                        width: 100%;
                        height: 100%;
                        border: none;
                    }
                    
                    .video-title {
                        position: absolute;
                        top: 6px;
                        left: 0px;
                        z-index: 100;
                        background: rgba(0, 0, 0, 0.7);
                        padding: 8px 15px;
                        border-radius: 5px;
                        font-size: 16px;
                        max-width: 250px;
                        overflow: hidden;
                        white-space: nowrap;
                    }

                    /* efek jalan */
                    .video-title.marquee span {
                        display: inline-block;
                        padding-left: 100%; /* mulai dari kanan */
                        animation: marquee 10s linear infinite;
                    }

                    @keyframes marquee {
                        0%   { transform: translateX(0); }
                        100% { transform: translateX(-100%); }
                    }
                    
                    .watermark {
                        position: absolute;
                        top: 20px;
                        right: 20px;
                        z-index: 100;
                        opacity: 0.7;
                        transition: opacity 0.3s;
                    }
                    
                    .watermark img {
                        height: 40px;
                        width: auto;
                    }
                    
                    .watermark:hover {
                        opacity: 1;
                    }
                    
                    .server-selector {
                        position: absolute;
                        top: 0;
                        left: 0;
                        height: 100%;
                        width: 280px;
                        background: rgba(10, 10, 26, 0.95);
                        padding: 15px;
                        transform: translateX(-100%);
                        transition: transform 0.4s ease;
                        z-index: 101;
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                        overflow-y: auto;
                    }
                    
                    .server-selector.visible {
                        transform: translateX(0);
                    }
                    
                    .server-btn {
                        background: rgba(255, 255, 255, 0.1);
                        border: 1px solid rgba(255, 255, 255, 0.3);
                        color: white;
                        padding: 8px 12px;
                        border-radius: 15px;
                        cursor: pointer;
                        transition: all 0.3s;
                        font-size: 12px;
                        text-align: left;
                    }
                    
                    .server-btn:hover {
                        background: rgba(255, 255, 255, 0.2);
                    }
                    
                    .server-btn.active {
                        background: #4a36d6;
                        border-color: #4a36d6;
                    }
                    
                    .burger-btn {
                        position: absolute;
                        bottom: 20px;
                        left: 20px;
                        z-index: 102;
                        background: rgba(255, 255, 255, 0.1);
                        width: 50px;
                        height: 50px;
                        border-radius: 50%;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        cursor: pointer;
                        transition: all 0.3s;
                    }
                    
                    .burger-btn:hover {
                        background: rgba(255, 255, 255, 0.2);
                    }
                    
                    .burger-btn span {
                        display: block;
                        width: 24px;
                        height: 3px;
                        background: white;
                        position: relative;
                    }
                    
                    .burger-btn span::before,
                    .burger-btn span::after {
                        content: '';
                        position: absolute;
                        width: 24px;
                        height: 3px;
                        background: white;
                        left: 0;
                    }
                    
                    .burger-btn span::before {
                        top: -8px;
                    }
                    
                    .burger-btn span::after {
                        bottom: -8px;
                    }
                    
                    .nav-btn {
                        position: absolute;
                        top: 35%;
                        height: 30%;
                        width: 10%;
                        z-index: 99;
                        background: transparent;
                        border: none;
                        cursor: pointer;
                        opacity: 0;
                        transition: opacity 0.3s;
                    }
                    
                    .video-container:hover .nav-btn {
                        opacity: 0.3;
                    }
                    
                    .video-container .nav-btn:hover {
                        opacity: 0.7;
                        background: rgba(0, 0, 0, 0.1);
                    }
                    
                    .prev-btn {
                        left: 0;
                    }
                    
                    .next-btn {
                        right: 0;
                    }
                    
                    .nav-btn::after {
                        content: '';
                        position: absolute;
                        top: 50%;
                        width: 30px;
                        height: 30px;
                        border-top: 3px solid white;
                        border-right: 3px solid white;
                        transform: translateY(-50%);
                    }
                    
                    .prev-btn::after {
                        left: 20%;
                        transform: translateY(-50%) rotate(-135deg);
                    }
                    
                    .next-btn::after {
                        right: 20%;
                        transform: translateY(-50%) rotate(45deg);
                    }
                    
                    .tutorial-overlay {
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background: rgba(0, 0, 0, 0.9);
                        z-index: 1000;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        opacity: 0;
                        pointer-events: none;
                        transition: opacity 0.5s;
                    }
                    
                    .tutorial-overlay.visible {
                        opacity: 1;
                        pointer-events: all;
                    }
                    
                    .tutorial-content {
                        background: #1a1a2e;
                        padding: 30px;
                        border-radius: 10px;
                        max-width: 500px;
                        text-align: center;
                    }
                    
                    .tutorial-content h2 {
                        margin-bottom: 20px;
                        color: #6c63ff;
                    }
                    
                    .tutorial-content p {
                        margin-bottom: 15px;
                        line-height: 1.5;
                    }
                    
                    .tutorial-indicator {
                        display: flex;
                        justify-content: center;
                        gap: 10px;
                        margin-top: 20px;
                    }
                    
                    .indicator {
                        width: 10px;
                        height: 10px;
                        border-radius: 50%;
                        background: rgba(255, 255, 255, 0.3);
                    }
                    
                    .indicator.active {
                        background: #6c63ff;
                    }
                    
                    .close-tutorial {
                        margin-top: 20px;
                        padding: 8px 20px;
                        background: #6c63ff;
                        color: white;
                        border: none;
                        border-radius: 20px;
                        cursor: pointer;
                    }
                    
                    .hint {
                        position: absolute;
                        bottom: 80px;
                        left: 20px;
                        background: rgba(0, 0, 0, 0.7);
                        padding: 10px 15px;
                        border-radius: 5px;
                        font-size: 14px;
                        opacity: 0;
                        transition: opacity 0.3s;
                        pointer-events: none;
                    }
                    
                    .hint.visible {
                        opacity: 1;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="video-wrapper">
                        <div class="video-container">
                            <iframe src="${defaultServer.embed}" allowfullscreen=""></iframe>
                            
                            <div class="video-title" id="videoTitle">${episode.title} - ${episode.episode}</div>
                            
                            <div class="watermark">
                                <img src="https://files.catbox.moe/evmloe.png" alt="Watermark">
                            </div>
                            
                            <button class="nav-btn prev-btn" ${prevEpisode ? '' : 'disabled style="opacity: 0; cursor: default;"'}></button>
                            <button class="nav-btn next-btn" ${nextEpisode ? '' : 'disabled style="opacity: 0; cursor: default;"'}></button>
                        </div>
                    </div>
                    
                    <div class="server-selector">
                        ${episode.servers.map(server => `
                            <button class="server-btn ${server === defaultServer ? 'active' : ''}" 
                                    onclick="changeServer('${server.embed}', this, '${server.server} - ${server.quality}')">
                                ${server.server} - ${server.quality}
                            </button>
                        `).join('')}
                    </div>
                    
                    <div class="burger-btn">
                        <span></span>
                    </div>
                    
                    <div class="hint">Klik tombol burger untuk memilih server</div>
                </div>
                
                <div class="tutorial-overlay">
                    <div class="tutorial-content">
                        <h2>Cara Menggunakan Pemutar Video</h2>
                        <p>1. Gunakan tombol panah kiri dan kanan untuk navigasi video</p>
                        <p>2. Tombol burger di pojok kiri bawah untuk memilih server</p>
                        <p>3. Menu server akan otomatis tersembunyi setelah 10 detik</p>
                        <p>4. Watermark akan selalu terlihat di pojok kanan atas</p>
                        
                        <div class="tutorial-indicator">
                            <div class="indicator active"></div>
                            <div class="indicator"></div>
                            <div class="indicator"></div>
                        </div>
                        
                        <button class="close-tutorial">Mengerti</button>
                    </div>
                </div>

                <script>
                    document.addEventListener('DOMContentLoaded', function() {
                        const burgerBtn = document.querySelector('.burger-btn');
                        const serverSelector = document.querySelector('.server-selector');
                        const prevBtn = document.querySelector('.prev-btn');
                        const nextBtn = document.querySelector('.next-btn');
                        const tutorialOverlay = document.querySelector('.tutorial-overlay');
                        const closeTutorial = document.querySelector('.close-tutorial');
                        const hint = document.querySelector('.hint');
                        const videoContainer = document.querySelector('.video-container');
                        const videoTitle = document.getElementById('videoTitle');
                        const titleEl = document.getElementById("videoTitle");
                        const text = titleEl.textContent.trim();
                        
                        // kalau panjang > 20 karakter → kasih efek jalan
                        if (text.length > 20) {
                            titleEl.innerHTML = '<span>' + text + '</span>';
                            titleEl.classList.add("marquee");
                        }
                        
                        let hideServerTimeout;
                        let hideControlsTimeout;
                        let tutorialSeen = localStorage.getItem('tutorialSeen');
                        
                        // Tampilkan tutorial jika pertama kali
                        if (!tutorialSeen) {
                            setTimeout(() => {
                                tutorialOverlay.classList.add('visible');
                                localStorage.setItem('tutorialSeen', 'true');
                            }, 1000);
                        }
                        
                        // Toggle menu server
                        burgerBtn.addEventListener('click', function() {
                            serverSelector.classList.toggle('visible');
                            
                            // Reset timeout untuk menyembunyikan menu
                            clearTimeout(hideServerTimeout);
                            if (serverSelector.classList.contains('visible')) {
                                hideServerTimeout = setTimeout(() => {
                                    serverSelector.classList.remove('visible');
                                }, 10000);
                            }
                        });
                        
                        // Tutup tutorial
                        closeTutorial.addEventListener('click', function() {
                            tutorialOverlay.classList.remove('visible');
                        });
                        
                        // Tampilkan hint saat hover burger button
                        burgerBtn.addEventListener('mouseenter', function() {
                            hint.classList.add('visible');
                        });
                        
                        burgerBtn.addEventListener('mouseleave', function() {
                            hint.classList.remove('visible');
                        });
                        
                        // Navigasi video
                        prevBtn.addEventListener('click', function() {
                            ${prevEpisode ? `window.location.href = '/play?episode=${prevEpisode.slug}';` : ''}
                        });
                        
                        nextBtn.addEventListener('click', function() {
                            ${nextEpisode ? `window.location.href = '/play?episode=${nextEpisode.slug}';` : ''}
                        });
                        
                        // Kontrol visibilitas tombol navigasi
                        function showNavigationButtons() {
                            if (!prevBtn.disabled) prevBtn.style.opacity = '0.3';
                            if (!nextBtn.disabled) nextBtn.style.opacity = '0.3';
                            
                            clearTimeout(hideControlsTimeout);
                            hideControlsTimeout = setTimeout(() => {
                                prevBtn.style.opacity = '0';
                                nextBtn.style.opacity = '0';
                            }, 10000);
                        }
                        
                        // Tampilkan tombol navigasi saat hover di video container
                        videoContainer.addEventListener('mouseenter', showNavigationButtons);
                        
                        // Sembunyikan tombol navigasi saat mouse meninggalkan video container
                        videoContainer.addEventListener('mouseleave', function() {
                            clearTimeout(hideControlsTimeout);
                            hideControlsTimeout = setTimeout(() => {
                                prevBtn.style.opacity = '0';
                                nextBtn.style.opacity = '0';
                            }, 1000);
                        });
                        
                        // Tampilkan tombol navigasi saat video diklik
                        videoContainer.addEventListener('click', function() {
                            showNavigationButtons();
                        });
                        
                        // Navigasi dengan keyboard
                        document.addEventListener('keydown', function(e) {
                            if (e.key === 'ArrowLeft' && !prevBtn.disabled) {
                                ${prevEpisode ? `window.location.href = '/play?episode=${prevEpisode.slug}';` : ''}
                            } else if (e.key === 'ArrowRight' && !nextBtn.disabled) {
                                ${nextEpisode ? `window.location.href = '/play?episode=${nextEpisode.slug}';` : ''}
                            }
                        });
                        
                        // Tampilkan tombol navigasi saat halaman pertama dimuat
                        showNavigationButtons();
                    });
                    
                    // Fungsi ganti server
                    function changeServer(url, element, title) {
                        document.querySelector('.video-container iframe').src = url;
                        
                        // Update judul dengan kualitas server
                        const titleElement = document.getElementById('videoTitle');
                        const baseTitle = '${episode.title} - ${episode.episode}';
                        titleElement.textContent = baseTitle + ' (' + title + ')';
                        
                        // Reset efek marquee jika perlu
                        const text = titleElement.textContent.trim();
                        if (text.length > 20) {
                            titleElement.innerHTML = '<span>' + text + '</span>';
                            titleElement.classList.add("marquee");
                        } else {
                            titleElement.innerHTML = text;
                            titleElement.classList.remove("marquee");
                        }
                        
                        // Set active button
                        document.querySelectorAll('.server-btn').forEach(btn => {
                            btn.classList.remove('active');
                        });
                        element.classList.add('active');
                        
                        // Sembunyikan menu server setelah memilih
                        document.querySelector('.server-selector').classList.remove('visible');
                    }
                </script>
            </body>
            </html>
        `);
        
    } catch (error) {
        console.error('Player error:', error.message);
        res.status(500).send('Internal server error');
    }
});

// Endpoint API untuk mendapatkan semua data (JSON)
app.get('/api/all', async (req, res) => {
    try {
        const allData = await getAllJSONFiles();
        res.json(allData);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint API untuk mendapatkan data episode tertentu
app.get('/api/episode/:identifier', async (req, res) => {
    try {
        const episode = await getEpisodeByIdOrSlug(req.params.identifier);
        
        if (!episode) {
            return res.status(404).json({ error: 'Episode not found' });
        }
        
        res.json(episode);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server is running' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).send('Tidak ada yang ditemukan di sini');
});

// Export handler untuk Netlify Functions
module.exports.handler = serverless(app);