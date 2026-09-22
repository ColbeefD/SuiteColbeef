<?php

/**
 * Power BI PIN: solo protege el acceso desde la Suite (UI).
 * Nota: los enlaces de Power BI siguen siendo accesibles si alguien copia la URL directa.
 */

$b64 = env('POWERBI_PIN_HASH_B64');
$fromB64 = '';
if (is_string($b64) && trim($b64) !== '') {
    $decoded = base64_decode(trim($b64), true);
    if ($decoded !== false && strlen($decoded) >= 50) {
        $fromB64 = $decoded;
    }
}

$pinHash = $fromB64 !== '' ? $fromB64 : trim((string) env('POWERBI_PIN_HASH', ''));

$secondaryDefaultB64 = 'JDJ5JDEyJGhmSzNnVHg3SkV5eXZQNENLZVlTb3VDQVVSZDQySHlYUS5tVlBRQUZGdkZoOHowcVdTeXBh';
$secondaryB64 = env('SECONDARY_PIN_HASH_B64', $secondaryDefaultB64);
$secondaryFromB64 = '';
if (is_string($secondaryB64) && trim($secondaryB64) !== '') {
    $decoded = base64_decode(trim($secondaryB64), true);
    if ($decoded !== false && strlen($decoded) >= 50) {
        $secondaryFromB64 = $decoded;
    }
}

$secondaryPinHash = $secondaryFromB64 !== ''
    ? $secondaryFromB64
    : trim((string) env('SECONDARY_PIN_HASH', ''));

return [
    'pin_hash' => $pinHash,
    'secondary_pin_hash' => $secondaryPinHash,
    'cookie_name' => env('POWERBI_PIN_COOKIE', 'WorkColbeef_powerbi_unlocked'),
    'ttl_minutes' => (int) env('POWERBI_PIN_TTL_MINUTES', 120),
];

