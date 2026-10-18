/** Public project links; device and account data never enter the footer. */
export function createAppFooter(): HTMLElement {
    const footer = document.createElement('footer');
    footer.className = 'app-footer';
    footer.append(`© ${new Date().getFullYear()} Aerya · `);
    const link = (label: string, href: string): void => {
        const anchor = document.createElement('a');
        anchor.textContent = label;
        anchor.href = href;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        footer.append(anchor);
    };
    link('GitHub', 'https://github.com/Aerya/Shield-Controller');
    footer.append(' · ');
    link('UpAndClear', 'https://upandclear.org');
    footer.append(' · ');
    link('Ko-fi', 'https://ko-fi.com/upandclear');
    footer.append(' · ');
    const credit = document.createElement('span');
    credit.textContent = 'Based on ';
    footer.append(credit);
    link('bilbospocketses/ws-scrcpy-web', 'https://github.com/bilbospocketses/ws-scrcpy-web');
    const thanks = document.createElement('span');
    thanks.textContent = ' — thank you for the original project.';
    footer.append(thanks);
    return footer;
}
