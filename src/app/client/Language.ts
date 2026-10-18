import french from '../../common/locales/fr.json';

export type Language = 'fr' | 'en';
const dictionary = french as Record<string, string>;
const normalized = new Map(
    Object.entries(dictionary).map(([key, value]) => [key.trim().replace(/\s+/g, ' ').toLowerCase(), value]),
);
const storageKey = 'shield-controller-language';
let language: Language = 'en';
const originals = new WeakMap<Text, { source: string; rendered: string }>();
const attributes = new WeakMap<Element, Map<string, { source: string; rendered: string }>>();
const listeners = new Set<() => void>();
const excluded =
    'script,style,pre,code,textarea,[contenteditable],.xterm,[data-i18n-skip],.device-name-text:not(.unnamed),.device-serial,.manager-app strong,.list-files-row-name';

export function t(source: string): string {
    if (language !== 'fr') return source;
    if (dictionary[source]) return dictionary[source]!;
    const trimmed = source.trim();
    if (dictionary[trimmed]) return source.replace(trimmed, dictionary[trimmed]!);
    const match = normalized.get(trimmed.replace(/\s+/g, ' ').toLowerCase());
    if (match) return source.replace(trimmed, match);
    const rules: [RegExp, (...values: string[]) => string][] = [
        [/^Available (.+)$/, (_all, mount) => `Disponible ${mount}`],
        [/^Storage (.+)$/, (_all, mount) => `Stockage ${mount}`],
        [/^Connected Devices (.+)$/, (_all, suffix) => `Appareils connectés ${suffix}`],
        [/^(\d+) \/ (\d+) apps$/, (_all, shown, total) => `${shown} / ${total} applications`],
        [/^Uploading (.+): ([?\d]+)%$/, (_all, file, percent) => `Transfert de ${file} : ${percent} %`],
        [/^Installing (.+) on the device…$/, (_all, file) => `Installation de ${file} sur l’appareil…`],
        [/^(\d+) APK\(s\) installed successfully\.$/, (_all, count) => `${count} APK installé(s) avec succès.`],
        [/^Uninstalling (.+)…$/, (_all, pkg) => `Désinstallation de ${pkg}…`],
        [/^(.+) uninstalled\.$/, (_all, pkg) => `${pkg} désinstallé.`],
        [
            /^Uninstall (.+) for user 0\?([\s\S]*)$/,
            (_all, pkg, warning) =>
                `Désinstaller ${pkg} pour l’utilisateur 0 ?${warning ? '\n\nIl s’agit d’une application système. Sa suppression peut perturber la TV. Son image système reste sur l’appareil.' : ''}`,
        ],
        [
            /^(System|User)( · Disabled)? · Version code (.+)$/,
            (_all, kind, disabled, code) =>
                `${kind === 'System' ? 'Système' : 'Utilisateur'}${disabled ? ' · Désactivée' : ''} · Code de version ${code}`,
        ],
    ];
    for (const [pattern, render] of rules) if (pattern.test(trimmed)) return trimmed.replace(pattern, render);
    return source;
}

function translateTree(root: Node): void {
    if (root instanceof Element && root.closest(excluded)) return;
    if (root instanceof Text) {
        if (root.parentElement?.closest(excluded)) return;
        const current = root.data;
        const previous = originals.get(root);
        const source = previous && previous.rendered === current ? previous.source : current;
        const rendered = t(source);
        originals.set(root, { source, rendered });
        if (current !== rendered) root.data = rendered;
        return;
    }
    if (root instanceof Element) {
        let tracked = attributes.get(root);
        if (!tracked) {
            tracked = new Map();
            attributes.set(root, tracked);
        }
        for (const name of ['title', 'placeholder', 'aria-label', 'alt']) {
            const current = root.getAttribute(name);
            if (current === null) continue;
            const previous = tracked.get(name);
            const source = previous && previous.rendered === current ? previous.source : current;
            const rendered = t(source);
            tracked.set(name, { source, rendered });
            if (current !== rendered) root.setAttribute(name, rendered);
        }
    }
    root.childNodes.forEach(translateTree);
}

export function setLanguage(value: Language): void {
    language = value;
    try {
        localStorage.setItem(storageKey, value);
    } catch {
        /* Storage can be disabled. */
    }
    document.documentElement.lang = value;
    translateTree(document.body);
    listeners.forEach((listener) => {
        listener();
    });
}

export function initLanguage(): void {
    let stored: string | null = null;
    try {
        stored = localStorage.getItem(storageKey);
    } catch {
        /* Use browser language. */
    }
    setLanguage(stored === 'fr' || stored === 'en' ? stored : navigator.language.startsWith('fr') ? 'fr' : 'en');
    const observer = new MutationObserver((records) => {
        for (const record of records) {
            if (record.type === 'childList') record.addedNodes.forEach(translateTree);
            else translateTree(record.target);
        }
    });
    observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['title', 'placeholder', 'aria-label', 'alt'],
    });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
}

export function createLanguageToggle(inline = false): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = inline ? 'language-toggle language-toggle-inline' : 'language-toggle';
    button.dataset['i18nSkip'] = '';
    const update = (): void => {
        button.textContent = language.toUpperCase();
        button.setAttribute('aria-label', language === 'fr' ? 'Switch to English' : 'Passer en français');
        button.title = language === 'fr' ? 'Switch to English' : 'Passer en français';
    };
    update();
    listeners.add(update);
    button.addEventListener('click', () => setLanguage(language === 'fr' ? 'en' : 'fr'));
    // Modal buttons are short lived: release their listener when the dialog closes.
    if (inline)
        queueMicrotask(() =>
            button.closest('dialog')?.addEventListener('close', () => listeners.delete(update), { once: true }),
        );
    return button;
}
