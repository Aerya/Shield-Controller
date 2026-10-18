export function cpuUsage(samples: string): number | null {
    const rows = samples
        .split(/\r?\n/)
        .filter((row) => /^cpu\s/.test(row))
        .map((row) => row.trim().split(/\s+/).slice(1, 9).map(Number));
    if (rows.length !== 2 || rows.some((row) => row.length < 4 || row.some((value) => !Number.isFinite(value))))
        return null;
    const before = rows[0]!,
        after = rows[1]!;
    const total = after.reduce((a, b) => a + b, 0) - before.reduce((a, b) => a + b, 0);
    const idle = after[3]! + (after[4] ?? 0) - (before[3]! + (before[4] ?? 0));
    return total > 0 && idle >= 0 ? Math.round(Math.max(0, Math.min(100, (1 - idle / total) * 100)) * 10) / 10 : null;
}

export function temperatures(output: string): { name: string; celsius: number }[] {
    // Android lists stale cached readings first. Prefer the fresh HAL section.
    const current = output.includes('Current temperatures from HAL:')
        ? output.split('Current temperatures from HAL:')[1]!.split('Current cooling devices')[0]!
        : output;
    const values = new Map<string, number>();
    for (const match of current.matchAll(/Temperature\{mValue=([\d.-]+),\s*mType=\d+,\s*mName=([^,}]+)/g)) {
        const value = Number(match[1]);
        if (Number.isFinite(value) && value > -100 && value < 250)
            values.set(match[2]!.trim(), Math.round(value * 10) / 10);
    }
    return [...values].map(([name, celsius]) => ({ name, celsius }));
}

export function diskUsage(
    output: string,
): { mount: string; totalKiB: number; usedKiB: number; availableKiB: number; percent: number }[] {
    return output.split(/\r?\n/).flatMap((line) => {
        const match = /^\S+\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/.exec(line.trim());
        if (!match) return [];
        return [
            {
                mount: match[5]!,
                totalKiB: Number(match[1]),
                usedKiB: Number(match[2]),
                availableKiB: Number(match[3]),
                percent: Number(match[4]),
            },
        ];
    });
}
