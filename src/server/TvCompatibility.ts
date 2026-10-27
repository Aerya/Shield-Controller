// Curated compatibility facts, not a universal debloat list. Unknown packages stay unknown.
export const TV_COMPONENTS: Record<string, string> = {
    'com.google.android.gms': 'Google Play services',
    'com.android.vending': 'Google Play Store',
    'com.android.settings': 'Android settings',
    'com.android.tv.settings': 'TV settings',
    'com.android.systemui': 'System interface',
    'com.android.bluetooth': 'Bluetooth and remote control',
    'com.google.android.apps.tv.launcherx': 'Google TV home and startup integration',
    'com.google.android.tungsten.setupwraith': 'Google TV initial setup',
    'com.android.provision': 'Android initial setup',
    'com.google.android.leanback.ime': 'TV keyboard',
    'com.tcl.tvinput': 'TCL HDMI and tuner framework',
    'com.tcl.tv': 'TCL HDMI and Live TV player',
    'com.tcl.suspension': 'TCL input selector',
    'com.tcl.providers.config': 'TCL shared settings',
    'com.tcl.inputmethod.international': 'TCL keyboard',
    'org.droidtv.homeintentresolver': 'Philips Home button router',
    'org.droidtv.GlobalKey': 'Philips remote buttons',
    'org.droidtv.hdmiservice': 'Philips HDMI service',
    'org.droidtv.playtv': 'Philips Live TV',
    'org.droidtv.tvpowermanagerservice': 'Philips power management',
};
export const TV_FEATURES: Record<string, string> = {
    'com.google.android.apps.mediashell': 'Google Cast',
    'com.google.android.katniss': 'Voice search',
    'com.google.android.tv.remote.service': 'Phone remote control',
    'com.google.android.marvin.talkback': 'TalkBack accessibility',
    'com.google.android.apps.tv.dreamx': 'Screensaver; keep enabled on OLED displays',
    'com.android.dreams.basic': 'Screensaver; keep enabled on OLED displays',
};
export function persistentPackages(dump: string): string[] {
    return dump.split(/\n(?=\s*Package \[)/).flatMap((block) => {
        const pkg = /^\s*Package \[([\w.]+)\]/m.exec(block)?.[1];
        return pkg && /pkgFlags=\[[^\]]*\bPERSISTENT\b/.test(block) ? [pkg] : [];
    });
}
