/** Curated names, not labels extracted from APKs. Unknown packages stay explicitly unidentified. */
const catalog: Record<string, [string, string]> = {
    'com.nvidia.stats': [
        'NVIDIA usage statistics',
        'Collects NVIDIA usage statistics. Disabling may stop these reports; it does not guarantee a performance gain.',
    ],
    'com.nvidia.feedback': ['NVIDIA feedback', 'Sends feedback to NVIDIA. Disabling removes this reporting function.'],
    'com.nvidia.diagtools': [
        'NVIDIA diagnostic tools',
        'Provides NVIDIA troubleshooting tools. Disabling can limit diagnostics and support.',
    ],
    'com.google.android.feedback': [
        'Google feedback',
        'Sends feedback and diagnostic reports to Google. Disabling removes this reporting function.',
    ],
    'com.plexapp.mediaserver.smb': [
        'Plex Media Server',
        'Hosts Plex libraries and streams on this Shield. Disable only if you do not use this server; the Plex player is separate.',
    ],
    'com.plexapp.android': [
        'Plex player',
        'Plays media from Plex servers. Disabling prevents watching Plex on this Shield; it does not optimize the server database.',
    ],
    'org.videolan.vlc': [
        'VLC',
        'Plays local and network media. Disabling makes VLC unavailable; it does not configure library scans.',
    ],
    'ar.tvplayer.tv': [
        'TiviMate',
        'IPTV player. Disabling prevents playback in TiviMate. Protect it manually to keep it protected while closed.',
    ],
    'org.xbmc.kodi': ['Kodi', 'Media player and library. Disabling stops access to Kodi and its add-ons.'],
    'com.netflix.ninja': ['Netflix', 'Netflix streaming app. Disabling makes Netflix unavailable on this Shield.'],
    'com.amazon.amazonvideo.livingroom.nvidia': [
        'Prime Video',
        'Amazon video streaming app. Disabling makes Prime Video unavailable on this Shield.',
    ],
    'com.amazon.amazonvideo.livingroom': [
        'Prime Video',
        'Amazon video streaming app. Disabling makes Prime Video unavailable on this Shield.',
    ],
    'com.amazon.music.tv': ['Amazon Music', 'Amazon music streaming app. Disabling stops access to this service.'],
    'com.google.android.youtube.tv': ['YouTube', 'YouTube TV app. Disabling prevents using this app to watch videos.'],
    'com.disney.disneyplus': ['Disney+', 'Disney+ streaming app. Disabling stops access to this app.'],
    'com.spotify.tv.android': ['Spotify', 'Spotify TV app. Disabling stops music playback through this app.'],
    'com.google.android.tvlauncher': [
        'Android TV Home',
        'Android TV home screen. Switch to another launcher before disabling. The currently resolved launcher is protected.',
    ],
    'com.google.android.leanbacklauncher': [
        'Android TV Launcher',
        'Android TV home screen. Switch to another launcher before disabling. The currently resolved launcher is protected.',
    ],
    'com.google.android.tvrecommendations': [
        'Android TV recommendations',
        'Provides home-screen recommendations. Disabling can remove suggestions and affect home-screen content.',
    ],
    'com.spocky.projengmenu': [
        'Projectivy Launcher',
        'Alternative TV home screen. The currently resolved launcher is protected.',
    ],
    'com.android.tv.settings': [
        'Android TV settings',
        'Controls TV settings. Disabling can prevent changing network, display and other device settings.',
    ],
    'com.android.settings': [
        'Android settings',
        'Controls device settings. Disabling can prevent configuring the device.',
    ],
    'com.android.systemui': [
        'Android system interface',
        'Provides system interface elements. Disabling can disrupt navigation and essential TV controls.',
    ],
    'com.google.android.gms': [
        'Google Play services',
        'Shared Google services used by many apps. Disabling can break sign-in and dependent applications.',
    ],
    'com.android.vending': [
        'Google Play Store',
        'Installs and updates applications. Disabling stops access to the store and may prevent app updates.',
    ],
    'com.google.android.webview': [
        'Android System WebView',
        'Displays web content inside applications. Disabling can break embedded web pages and sign-in screens.',
    ],
    'com.android.bluetooth': [
        'Android Bluetooth',
        'Supports Bluetooth connections. Disabling can disconnect controllers, headphones or other accessories.',
    ],
    'com.android.providers.downloads': [
        'Android download manager',
        'Handles downloads for other apps. Disabling can prevent downloads and updates.',
    ],
    'com.android.providers.media': [
        'Android media storage',
        'Indexes shared media for applications. Disabling can make media unavailable to other apps.',
    ],
    'com.google.android.inputmethod.latin': [
        'Gboard / Google keyboard',
        'On-screen keyboard. Disabling can prevent text entry unless another keyboard is available.',
    ],
    'com.google.android.inputmethod.korean': [
        'Google Korean keyboard',
        'Korean text input. Disabling removes this keyboard; keep another input method available.',
    ],
    'com.nvidia.bbciplayer': [
        'BBC iPlayer',
        'BBC streaming app integration. Disabling removes the related playback or launch function.',
    ],
    'com.nvidia.bbciplayer.launch': [
        'BBC iPlayer shortcut',
        'Launches BBC iPlayer. Disabling removes this launch integration.',
    ],
    'com.nvidia.bbciplayer.launchsport': [
        'BBC Sport shortcut',
        'Launches BBC Sport content. Disabling removes this launch integration.',
    ],
    'com.zattoo.player': ['Zattoo', 'Live TV player. Disabling prevents watching TV through Zattoo.'],
    'air.ITVMobilePlayer': ['ITV player', 'ITV streaming app. Disabling stops access to this app.'],
    'air.com.vudu.air.DownloaderTablet': ['Vudu', 'Vudu video app. Disabling stops access to this app.'],
};
export function optimizationDescription(
    packageName: string,
    system: boolean | null,
): { name: string; explanation: string } {
    const known = catalog[packageName];
    if (known) return { name: known[0], explanation: known[1] };
    return {
        name: system === true ? 'Unidentified system component' : 'Unidentified application',
        explanation:
            system === true
                ? 'Role not documented in this catalog. This system package may support TV functions. Check its package identifier before disabling; re-enabling restores access without deleting data.'
                : 'Name and role not documented in this catalog. Check the package identifier on your TV. Disabling stops this app and its background services until re-enabled.',
    };
}
