// Profiles describe observed firmware differences; never import a bulk-disable list.
export function tvProfile(manufacturer: string, product: string) {
    if (!/nvidia/i.test(manufacturer))
        return { model: null, notes: ['No verified model profile. Keep unknown components enabled.'] };
    const models: Record<string, string> = {
        darcy: 'SHIELD TV 2017',
        foster: 'SHIELD TV 2015/2017',
        foster_e: 'SHIELD TV 2015/2017',
        sif: 'SHIELD TV 2019 (tube)',
        mdarcy: 'SHIELD TV Pro 2019',
    };
    return {
        model: models[product.trim()] ?? 'NVIDIA SHIELD (model unverified)',
        notes: [
            'Keep TV recommendations enabled: the NVIDIA phone remote can depend on it after reboot.',
            'Keep NVIDIA firmware updates, Bluetooth pairing, audio and remote services enabled.',
            'A Shield has no HDMI inputs or built-in TV tuner.',
            ...(product.trim() === 'sif' ? ['The 2019 tube has no USB port; use network debugging.'] : []),
            'Model reports are advisory; firmware and installed packages can differ.',
        ],
    };
}
