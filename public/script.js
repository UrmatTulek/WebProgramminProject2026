let playlist = [];
let playlistIndex = 0;
let isShuffleActive = false;
let isRepeatActive = false;
let shuffleQueue = [];
let shuffleQueuePointer = 0;
let currentUser = null;
let searchTimeOut = null;
let songsArr = [];
let changingTimeline = false;
const audioPlayer = document.getElementById('main-audio');

$(document).ready(function() {
    const savedUser = localStorage.getItem('user');
    const $timeline = $('#trackTimeline');
    const $currentTimeText = $('#currentTime');
    const $durationText = $('#trackDuration');
    
    if(!savedUser){
        currentUser = {
            username: 'Guest',
            role: 'guest'
        }
        fetchAllSongs();
    }else{
        currentUser = JSON.parse(savedUser);
        fetchFavorites();
    }
    if(currentUser.role === 'admin'){
        $('#goAdminBtn').css('visibility', 'visible');
    }

    $('#welcome').html(`Welcome, <strong>${currentUser.username}</strong>`);
    
    if(currentUser.role === 'guest'){
        $('#logoutBtn').text('Sign in').off('click').on('click', () => {
            window.location.href = '/login.html';
        })
    }else{
        $('#logoutBtn').text('Log out');
    }

    async function loadRadioStations() {
        try{
            const response = await fetch('/api/radio-stations');
            const data = await response.json();
            const $container = $('#radio-container');
            $container.empty();

            if(data && data.data){
                let htmlBuffer = '';

                data.data.forEach(radio => {
                    const streamURL = radio.streams[0]?.url || '';
                    const backupURL = radio.streams[1]?.url;
                    if(streamURL){
                        htmlBuffer += `
                            <div class="radio-card" data-stream="${streamURL}" data-backup="${backupURL}">
                                <div class="song-info">
                                    <span class="song-title">${radio.name}</span>   
                                    <span class="radio-tags">${radio.tags?.join('') || 'Live Radio'}</span>
                                </div>    
                                <button class="button button--play playBtn radio-play-btn">
                                    <i class="ph ph-play"></i>
                                    <i class="ph ph-pause"></i>
                                </button>
                            </div>
                        `;
                    }
                });
                $container.append(htmlBuffer);
                initRadioCLick();
            }
        }catch(err){
            console.error("Failed to render the Radio API");
        }
    }



    $('#skipBack').on('click', skipBack);
    $('#skipForward').on('click', skipForward);
    $('#shuffleBtn').on('click', toggleShuffle);
    $('#repeatBtn').on('click', toggleRepeat);

    $(document).on('click', '.song-card', function(){
        const selectedIndex = $(this).data('index');
        playTrack(selectedIndex);
    });

    audioPlayer.addEventListener('ended', () => {
        if(!isRepeatActive && playlistIndex === playlist.length - 1){
            $('#masterPlayBtn').removeClass('is-active');
            return;
        }
        skipForward();
    }); 

    $('#searchBar').on('input', function(){
        const seacrhPrompt = $(this).val().trim();
        clearTimeout(searchTimeOut);
        if(seacrhPrompt === ''){
            if(currentUser.role === 'guest'){
                fetchAllSongs();
            }else{
                fetchFavorites();
            }
            return;
        };

        searchTimeOut = setTimeout(() => {
            fetchSearch(seacrhPrompt);
        }, 300);
    });

    function updateTimelineColor(current, maxValue){
        const percentage = maxValue > 0 ? (current / maxValue) * 100 : 0;
        $timeline.css('background', `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${percentage}%, var(--color-background-primary) ${percentage}%, var(--color-background-primary) 100%)`);
    }

    audioPlayer.addEventListener('loadedmetadata', () => {
        const duration = audioPlayer.duration;
        $timeline.attr('max', duration);
        $timeline.val(0);
        $durationText.text(formatTime(duration));
    });

    audioPlayer.addEventListener('timeupdate', () => {
        const currentTime = audioPlayer.currentTime;
        const duration = audioPlayer.duration || 100;

        if(!changingTimeline){
            $timeline.val(currentTime);
            updateTimelineColor($timeline.val(), duration);
        }

        $currentTimeText.text(formatTime(currentTime));
    });

    $timeline.on('input', function(){
        changingTimeline = true;
        const val = $(this).val();
        const max = $(this).attr('max') || 100;

        $currentTimeText.text(formatTime(val));
        updateTimelineColor(val, max);
    });

    $timeline.on('change', function(){
        const targetTime = $(this).val();
        audioPlayer.currentTime = targetTime;

        const max = $(this).attr('max') || 100;
        updateTimelineColor(targetTime, max);
        changingTimeline = false;
    });

    $('#songsList').off('click', '.fav-toggle-btn').on('click', '.fav-toggle-btn', async function(e){
        e.stopPropagation();

        const $btn = $(this);
        const $card = $btn.closest('.song-card');
        const songId = $card.attr('data-song-id');
        const user = JSON.parse(localStorage.getItem('user'));

        if(!user || user.role === "guest"){
            window.alert("You must be logged in!");
            window.location.href = '/login.html';
            return;
        }

        const wasFavorited = $btn.hasClass('is-favorited');

        try{
            const response = await fetch('/api/favorites/toggle', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: user.id,
                    songId: songId
                })
            });
            const statusData = await response.json();

            if(response.ok){
                $btn.toggleClass('is-favorited', statusData.isFavorited);
            }else{
                $btn.toggleClass('is-favorited', wasFavorited);
                console.error("Backend failed to sync the data", statusData.message);
            }
        }catch(err){
            $btn.toggleClass('is-favorited', wasFavorited);
            console.error("Network error!", err);
        }

    });

    loadRadioStations();
});

function sanitize(str){
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

$('#volumeSlider').on('input', function(){
    const volume = parseFloat($(this).val());
    const icon = $('.volume-box i');

    audioPlayer.volume = volume;

    icon.removeClass('ph-speaker-high ph-speaker-low ph-speaker-none ph-speaker-slash');

    if(volume === 0){
        icon.addClass('ph-speaker-slash');
    }else if(volume < 0.3){
        icon.addClass('ph-speaker-none');
    }else if(volume < 0.7){
        icon.addClass('ph-speaker-low');
    }else{
        icon.addClass('ph-speaker-high');
    }
});

function displayMusicCards(songs, isSearchResults = false){
    const $container = $('#songsList');
    if(songs.length === 0){
        $container.html('<p class="empty-msg">No songs found in your library</p>');
        return;
    }
    
    playlist = [...songs];
    const htmlContent = songs.map((song, index) =>{ 
        const favoriteClass = (song.is_fav === 1 || song.is_fav === true) ? "is-favorited" : "";
        return `
        <div class="song-card" data-index="${index}" data-song-id="${sanitize(String(song.id))}">
            <div class="song-info">
                <span class="song-title">${sanitize(song.title)}</span>
                <span class="song-artist">${sanitize(song.artist)}</span>
            </div>
            <div class="card-controls">
                <button class="fav-toggle-btn ${favoriteClass}">
                    <i class="ph ph-heart icon-outline"></i>
                    <i class="ph-fill ph-heart icon-filled"></i>
                </button>
                <button class="button button--play playBtn track-play-btn">
                    <i class="ph ph-play"></i>
                    <i class="ph ph-pause"></i>
                </button>
            </div>
        </div>
        `
    }).join('');
    $container.html(htmlContent);
};

async function fetchAllSongs(){
    try{
        const response = await fetch('/api/songs');
        const songs = await response.json();
        displayMusicCards(songs, false);
    }catch(err){
        console.error(err);
        displayMusicCards([], false);
    }
}

async function fetchFavorites(){

    if(!currentUser || currentUser.role === 'guest'){
        console.error('You must be logged in!');
        return;
    };

    try{
        const response = await fetch(`/api/favorites/${currentUser.id}`);
        const songs = await response.json();

        playlist = songs;
        playlistIndex = -1;
        displayMusicCards(songs, false);
    }catch(err){
        console.error(err);
        displayMusicCards([], false);
    }
};

async function fetchSearch(queryText){
    const userId = currentUser ? currentUser.id : "";
    try{
        const response = await fetch(`/api/songs/search?query=${encodeURIComponent(queryText)}&userId=${userId}`);
        const songs = await response.json();

        playlist = songs;
        playlistIndex = -1;
        displayMusicCards(songs, true);
    }catch(err){
        console.error(err);
    }
}

function playTrack(index){
    if(!currentUser || currentUser.role === 'guest'){
        window.alert("You must be logged in!");
        window.location.href = '/login.html';
        return;
    }

    if(index < 0 || index >= playlist.length) return;
    $('.radio-card').removeClass('is-active');

    if(playlistIndex === index && audioPlayer.src !== ""){
        if(!audioPlayer.paused){
            audioPlayer.pause();
            $(`.song-card[data-index=${index}]`).find('.playBtn').removeClass('is-active');
            $('#masterPlayBtn').removeClass('is-active');
        }else{
            audioPlayer.play().catch(err => console.error("Failed to resume!"));
            $(`.song-card[data-index=${index}]`).find('.playBtn').addClass('is-active');
            $('#masterPlayBtn').addClass('is-active');
        }
        return;
    }

    playlistIndex = index;
    const track = playlist[playlistIndex];

    const titleDisplay = $('#current-track-title');
    const artistDisplay = $('#current-track-artist');

    if(isShuffleActive && shuffleQueue.length > 0){
        const queueIndex = shuffleQueue.indexOf(index);
        if(queueIndex !== -1){
            shuffleQueuePointer = queueIndex;
        }
    }

    audioPlayer.src = `/music/${track.file_path}`;
    console.log(audioPlayer.src);
    titleDisplay.text(track.title);
    artistDisplay.text(track.artist);

    audioPlayer.load();
    audioPlayer.play().catch(error => {
        console.error("Player failed. Check if file exists at: ", audioPlayer.src);
    });

    $('.song-card').removeClass('is-active');
    $('.playBtn').removeClass('is-active');
    $('.button--play').removeClass('is-active');

    const $activeCard = $(`.song-card[data-index="${index}"]`);
    $activeCard.addClass('is-active');
    $activeCard.find('.playBtn').addClass('is-active');
    $('#masterPlayBtn').addClass('is-active');
}

function skipForward(){
    if(playlist.length === 0) return;

    if(isShuffleActive && shuffleQueue.length > 0){
        if(shuffleQueuePointer < shuffleQueue.length - 1){
            shuffleQueuePointer++;
            playTrack(shuffleQueue[shuffleQueuePointer]);
        }else if(isRepeatActive){
            shuffleQueuePointer = 0;
            playTrack(shuffleQueue[shuffleQueuePointer]);
        }else{
            audioPlayer.currentTime = 0;
            $('#masterPlayBtn').removeClass('is-active');
        }
    }else{
        if(playlistIndex < playlist.length - 1){
            playTrack(playlistIndex + 1);
        }else if(isRepeatActive){
            playTrack(0);
        }else{
            $('#masterPlayBtn').removeClass('is-active');
        }
    }
}

function skipBack(){
    if(playlist.length === 0) return;

    if(audioPlayer.currentTime > 3){
        audioPlayer.currentTime = 0;
        return;
    }

    if(isShuffleActive && shuffleQueue.length > 0){
        if(shuffleQueuePointer > 0){
            shuffleQueuePointer--;
            playTrack(shuffleQueue[shuffleQueuePointer]);
        }else if(isRepeatActive){
            shuffleQueuePointer = shuffleQueue.length - 1;
            playTrack(shuffleQueue[shuffleQueuePointer]);
        }
    }else{
        if(playlistIndex > 0){
            playTrack(playlistIndex - 1);
        }else if(isRepeatActive){
            playTrack(playlist.length - 1);
        }else{
            
        }
    }
}

function toggleShuffle(){
    isShuffleActive = !isShuffleActive;
    const shuffleBtn = $('#shuffleBtn');

    if(isShuffleActive){
        shuffleBtn.addClass('is-active');
        shuffleQueue = Array.from({length: playlist.length}, (_, i) => i);

        for(let i = shuffleQueue.length - 1; i > 0; i--){
            const j = Math.floor(Math.random() * (i + 1));
            [shuffleQueue[i], shuffleQueue[j]] = [shuffleQueue[j], shuffleQueue[i]];
        }

        const queueIndex = shuffleQueue.indexOf(playlistIndex);
        if(queueIndex !== -1){
            shuffleQueue.splice(queueIndex, 1);
            shuffleQueue.unshift(playlistIndex);
        }
        shuffleQueuePointer = 0;
    }else{
        shuffleBtn.removeClass('is-active');
        shuffleQueue = [];
        shuffleQueuePointer = 0;
    }
}

function toggleRepeat(){
    isRepeatActive = !isRepeatActive;
    const repeatBtn = $('#repeatBtn');
    if(isRepeatActive){
        repeatBtn.addClass('is-active');
        audioPlayer.loop = false;
    }else{
        repeatBtn.removeClass('is-active');
    }
}

function formatTime(seconds){
    if(isNaN(seconds) || seconds === Infinity) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0':''}${secs}`;
}

function initRadioCLick(){
    $('#radio-container').off('click', '.radio-play-btn').on('click', '.radio-play-btn', function(e){
        e.stopPropagation();
        const $btn = $(this);
        const $card = $btn.closest('.radio-card');
        const streamUrl = $card.attr('data-stream');
        const backupStream = $card.attr('data-backup');
        const stationName = $card.find('.song-title').text();

        if($card.hasClass('is-active')){
            if(!audioPlayer.paused){
                audioPlayer.pause();
                $('#masterPlayBtn').removeClass('is-active');
                $btn.removeClass('is-active');
                return;
            }else{
                audioPlayer.load();
                audioPlayer.play().then(() => {
                    $('#masterPlayBtn').addClass('is-active');
                    $btn.addClass('is-active');
                }).catch(() => triggerBackup());
                return;
            }
        }

        $('.radio-card').removeClass('is-active');
        $('.radio-card .radio-play-btn').removeClass('is-active');
        $('.song-card').removeClass('is-active');
        $card.addClass('is-active');
        $btn.addClass('is-active');

        playlistIndex = -1;
        if(typeof isShuffleActive !== 'undefined') isShuffleActive = false;
        $('#shuffleBtn').removeClass('is-active');
        $('#repeatBtn').removeClass('is-active');

        audioPlayer.src = streamUrl;
        $('#current-track-title').text(stationName);
        $('#current-track-artist').text("Live Radio Stream");

        audioPlayer.load();
        audioPlayer.play().then(() => {
            $('#masterPlayBtn').addClass('is-active');
        }).catch(() => triggerBackup());

        audioPlayer.onerror = function(){
            triggerBackup();
        };

        function triggerBackup(){
            if(backupStream && audioPlayer.src !== backupStream){
                console.warn("Main stream failed. Swapping to the next one...");
                audioPlayer.src = backupStream;
                audioPlayer.load();
                audioPlayer.play().catch(err => console.error("Backup stream failed too:", err));
            }else{
                $('#current-track-title').text("Offline");
                $('#masterPlayBtn').removeClass('is-active');
                $card.removeClass('is-active');
            }
        }
    });
}

$('#masterPlayBtn').on('click', function(){
    const $radioCard = $('.radio-card.is-active');
    if($radioCard.length > 0){
        if(!audioPlayer.paused){
            audioPlayer.pause();
            $(this).removeClass('is-active');
            $radioCard.find('.radio-play-btn').removeClass('is-active');
        }else{
            audioPlayer.load();
            audioPlayer.play().then(() => {
                $(this).addClass('is-active');
                $radioCard.find('.radio-play-btn').addClass('is-active');
            });
        }
    }else{
        if(audioPlayer.src){
            const $currentSongCard = $(`.song-card[data-index="${playlistIndex}"]`);
            if(audioPlayer.paused){
                audioPlayer.play();
                $(this).addClass('is-active');
                if($currentSongCard.length > 0){
                    $currentSongCard.find('.playBtn').addClass('is-active');
                }
            }else{
                audioPlayer.pause();
                $(this).removeClass('is-active');
                if($currentSongCard.length > 0){
                    $currentSongCard.find('.playBtn').removeClass('is-active');
                }
            }
        }
    }
});

$('#goAdminBtn').on('click', function(){
    window.location.href = '/admin.html';
});

$('#logoutBtn').on('click', function(){
    localStorage.removeItem('user');
    window.location.href = '/login.html';
});
