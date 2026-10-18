// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { createLanguageToggle, initLanguage, setLanguage, t } from './Language';

beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    setLanguage('en');
});
it('switches existing and newly inserted text in both directions without losing actions or translating user data', async () => {
    initLanguage();
    const button = document.createElement('button');
    button.textContent = 'Refresh';
    const click = vi.fn();
    button.onclick = click;
    const data = document.createElement('span');
    data.dataset['i18nSkip'] = '';
    data.textContent = 'Refresh';
    document.body.append(button, data);
    setLanguage('fr');
    expect(button.textContent).toBe('Actualiser');
    expect(data.textContent).toBe('Refresh');
    button.click();
    expect(click).toHaveBeenCalledOnce();
    const input = document.createElement('input');
    input.placeholder = 'Username';
    input.value = 'Refresh';
    document.body.append(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(input.placeholder).toBe('Nom d’utilisateur');
    expect(input.value).toBe('Refresh');
    button.textContent = 'Cancel';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(button.textContent).toBe('Annuler');
    setLanguage('en');
    expect(button.textContent).toBe('Cancel');
    expect(input.placeholder).toBe('Username');
    window.dispatchEvent(new Event('pagehide'));
});
it('remembers the choice and offers an accessible language switch', () => {
    setLanguage('fr');
    initLanguage();
    const button = createLanguageToggle();
    document.body.append(button);
    expect(document.documentElement.lang).toBe('fr');
    expect(button.querySelector('[data-language=fr]')?.getAttribute('aria-pressed')).toBe('true');
    (button.querySelector('[data-language=en]') as HTMLButtonElement).click();
    expect(button.querySelector('[data-language=en]')?.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('shield-controller-language')).toBe('en');
    window.dispatchEvent(new Event('pagehide'));
});

it('translates the exact network discovery guidance and restores its English wording', () => {
    const source =
        'Click quick scan for modern Android devices on your network, or scan network to probe a full subnet. Make sure wireless debugging is enabled on the devices you wish to connect with.';
    setLanguage('fr');
    expect(t(source)).toContain('recherche rapide');
    expect(t(source)).toContain('débogage réseau');
    setLanguage('en');
    expect(t(source)).toBe(source);
});
