<?php

/**
 * Hash bcrypt: si MASTER_PASSWORD_HASH_B64 está definido, se usa (evita problemas con $ en el .env).
 * Si no, se usa MASTER_PASSWORD_HASH (ideal entre comillas simples).
 */
$b64 = env('MASTER_PASSWORD_HASH_B64');
$fromB64 = '';
if (is_string($b64) && trim($b64) !== '') {
    $decoded = base64_decode(trim($b64), true);
    if ($decoded !== false && strlen($decoded) >= 50) {
        $fromB64 = $decoded;
    }
}

$passwordHash = $fromB64 !== '' ? $fromB64 : trim((string) env('MASTER_PASSWORD_HASH', ''));

return [
    'password_hash' => $passwordHash,
    'jwt_secret' => trim((string) env('ADMIN_JWT_SECRET', '')),
    'jwt_ttl_minutes' => (int) env('ADMIN_JWT_TTL_MINUTES', 480),
    'cookie_name' => env('ADMIN_COOKIE_NAME', 'Worldbeef_admin_token'),
];
