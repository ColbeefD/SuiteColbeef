<?php

/**
 * Diagnóstico: lee MASTER_PASSWORD_HASH_B64 o MASTER_PASSWORD_HASH del .env (con/sin BOM, espacios).
 * Uso: php scripts/verify-b64-env.php [contraseña_a_probar]
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$plain = $argv[1] ?? 'Colbeef2026*';

$envPath = dirname(__DIR__) . '/.env';

/**
 * @return array{b64: string, legacy_hash: string}
 */
function WorldbeefParseEnvHashes(string $path): array
{
    $out = ['b64' => '', 'legacy_hash' => ''];
    if (! is_readable($path)) {
        return $out;
    }

    $content = file_get_contents($path) ?: '';
    if (str_starts_with($content, "\xEF\xBB\xBF")) {
        $content = substr($content, 3);
    }

    $lines = preg_split('/\r\n|\r|\n/', $content);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || (isset($line[0]) && $line[0] === '#')) {
            continue;
        }

        if (preg_match('/^MASTER_PASSWORD_HASH_B64\s*=\s*(.+)$/', $line, $m)) {
            $val = trim($m[1]);
            $val = trim($val, " \t\"'");
            $out['b64'] = $val;
            continue;
        }

        if (preg_match('/^MASTER_PASSWORD_HASH\s*=\s*(.+)$/', $line, $m)) {
            $val = trim($m[1]);
            $val = trim($val, " \t\"'");
            if (str_starts_with($val, "'") && str_ends_with($val, "'")) {
                $val = substr($val, 1, -1);
            }
            if (str_starts_with($val, '"') && str_ends_with($val, '"')) {
                $val = substr($val, 1, -1);
            }
            $out['legacy_hash'] = $val;
        }
    }

    return $out;
}

$parsed = WorldbeefParseEnvHashes($envPath);
$rawB64 = $parsed['b64'];
$legacy = $parsed['legacy_hash'];

$fromFile = '';
if ($rawB64 !== '') {
    $d = base64_decode($rawB64, true);
    if ($d !== false && strlen($d) >= 50) {
        $fromFile = $d;
    }
} elseif ($legacy !== '' && str_starts_with($legacy, '$2')) {
    $fromFile = $legacy;
}

$fromConfig = (string) config('admin.password_hash');
$cachedFile = dirname(__DIR__) . '/bootstrap/cache/config.php';

echo '--- Worldbeef: verificación contraseña maestra ---' . PHP_EOL;
echo 'probando_clave: ' . $plain . PHP_EOL;
echo 'archivo .env: ' . $envPath . ' (' . (is_readable($envPath) ? 'ok' : 'no legible') . ')' . PHP_EOL;

if ($rawB64 === '' && $legacy === '') {
    echo PHP_EOL . '>>> PROBLEMA: En .env NO hay MASTER_PASSWORD_HASH_B64=... ni MASTER_PASSWORD_HASH=...' . PHP_EOL;
    echo '    1) Ejecuta: php scripts/make-master-hash.php "' . $plain . '"' . PHP_EOL;
    echo '    2) Copia la linea MASTER_PASSWORD_HASH_B64=... al final de laravel/.env (guardar UTF-8).' . PHP_EOL;
    echo '    3) php artisan config:clear' . PHP_EOL . PHP_EOL;
} elseif ($rawB64 !== '' && $fromFile === '') {
    echo PHP_EOL . '>>> PROBLEMA: MASTER_PASSWORD_HASH_B64 existe pero no decodifica (Base64 cortado o mal copiado).' . PHP_EOL;
    echo '    Valor leido (primeros 40 chars): ' . substr($rawB64, 0, 40) . '...' . PHP_EOL . PHP_EOL;
}

echo 'archivo_cache_config: ' . (is_file($cachedFile) ? 'SI' : 'no') . PHP_EOL;
echo 'len(hash_desde_.env): ' . strlen($fromFile) . PHP_EOL;
echo 'len(hash_config_laravel): ' . strlen($fromConfig) . PHP_EOL;

if ($fromFile !== '' && $fromConfig !== '' && $fromFile !== $fromConfig) {
    echo '>>> MISMATCH_CONFIG: .env y config() distintos. Ejecuta: php artisan config:clear' . PHP_EOL;
}

$okFile = $fromFile !== '' && password_verify($plain, $fromFile);
$okConfig = $fromConfig !== '' && password_verify($plain, $fromConfig);

echo 'password_verify_desde_.env: ' . ($okFile ? 'OK' : 'BAD') . PHP_EOL;
echo 'password_verify_desde_config: ' . ($okConfig ? 'OK' : 'BAD') . PHP_EOL;

if (! $okConfig && is_file($cachedFile)) {
    echo PHP_EOL . 'Prueba: php artisan config:clear' . PHP_EOL;
}
