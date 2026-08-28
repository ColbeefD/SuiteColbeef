<?php

namespace App\Http\Controllers;

use App\Models\BugReport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Gestión de reportes de bugs / PQR del portal.
 *
 * store()        → alta pública (throttle): crea un ticket WB-YYYYMMDD-XXXXXX.
 * adminSummary() → panel admin: totales, tiempo medio de resolución, desglose
 *                  por software y casos recientes.
 * resolve()      → panel admin: marca un ticket como resuelto (resolved_at).
 *
 * @see \App\Models\BugReport
 */
class BugReportController extends Controller
{
    /** @var array<string, string> */
    private const SOFTWARE_LABELS = [
        'WorkColbeef-portal' => 'WorkColbeef (portal)',
        'control-operativo' => 'Control operativo',
        'gestion-humana' => 'Gestión humana',
        'logistica' => 'Logística',
        'calidad' => 'Calidad',
        'tesoreria-cartera' => 'Tesorería y cartera',
        'administrativo' => 'Administrativo',
        'power-bi' => 'Power BI',
        'otro' => 'Otro / no listado',
    ];

    public function store(Request $request): JsonResponse
    {
        if (! Schema::hasTable('bug_reports')) {
            return response()->json([
                'ok' => false,
                'error' => 'Registro de bugs no disponible. Ejecuta: php artisan migrate',
            ], 503);
        }

        $softwareKeys = implode(',', array_keys(self::SOFTWARE_LABELS));

        $validated = $request->validate([
            'software' => 'required|string|in:'.$softwareKeys,
            'tema' => 'required|string|max:120',
            'detalle' => 'required|string|max:200',
            'mensaje' => 'required|string|min:10|max:8000',
        ]);

        $ticketCode = $this->makeUniqueTicketCode();

        $row = BugReport::query()->create([
            'ticket_code' => $ticketCode,
            'software' => $validated['software'],
            'tema' => $validated['tema'],
            'detalle' => $validated['detalle'],
            'mensaje' => $validated['mensaje'],
            'status' => 'open',
            'visitor_hash' => $this->visitorHash($request),
        ]);

        return response()->json([
            'ok' => true,
            'ticket_code' => $row->ticket_code,
            'reported_at' => $row->created_at?->toIso8601String(),
            'software_label' => self::SOFTWARE_LABELS[$row->software] ?? $row->software,
        ], 201);
    }

    public function adminSummary(Request $request): JsonResponse
    {
        if (! Schema::hasTable('bug_reports')) {
            return response()->json([
                'ok' => false,
                'error' => 'Registro de bugs no disponible. Ejecuta: php artisan migrate',
            ], 503);
        }

        $days = (int) $request->query('days', 30);
        if ($days < 1) {
            $days = 1;
        }
        if ($days > 365) {
            $days = 365;
        }
        $since = now()->subDays($days)->startOfDay();

        $reportedInPeriod = BugReport::query()->where('created_at', '>=', $since);

        $totalReported = (clone $reportedInPeriod)->count();
        $openInPeriod = (clone $reportedInPeriod)->where('status', 'open')->count();
        $resolvedInPeriod = (clone $reportedInPeriod)->where('status', 'resolved')->count();

        $resolvedRows = BugReport::query()
            ->where('status', 'resolved')
            ->whereNotNull('resolved_at')
            ->where('resolved_at', '>=', $since)
            ->get(['created_at', 'resolved_at']);

        $secondsList = [];
        foreach ($resolvedRows as $b) {
            if ($b->created_at && $b->resolved_at && $b->resolved_at->greaterThanOrEqualTo($b->created_at)) {
                $secondsList[] = $b->created_at->diffInSeconds($b->resolved_at);
            }
        }
        $avgResolutionHours = count($secondsList) > 0
            ? round((array_sum($secondsList) / count($secondsList)) / 3600, 2)
            : null;

        $bySoftware = [];
        foreach (array_keys(self::SOFTWARE_LABELS) as $key) {
            $q = BugReport::query()->where('created_at', '>=', $since)->where('software', $key);
            $bySoftware[] = [
                'software' => $key,
                'label' => self::SOFTWARE_LABELS[$key],
                'total' => (clone $q)->count(),
                'open' => (clone $q)->where('status', 'open')->count(),
                'resolved' => (clone $q)->where('status', 'resolved')->count(),
            ];
        }

        $recent = BugReport::query()
            ->where('created_at', '>=', $since)
            ->orderByDesc('created_at')
            ->limit(80)
            ->get()
            ->map(function (BugReport $b) {
                return [
                    'id' => $b->id,
                    'ticket_code' => $b->ticket_code,
                    'software' => $b->software,
                    'software_label' => self::SOFTWARE_LABELS[$b->software] ?? $b->software,
                    'tema' => $b->tema,
                    'detalle' => $b->detalle,
                    'status' => $b->status,
                    'created_at' => $b->created_at?->toIso8601String(),
                    'resolved_at' => $b->resolved_at?->toIso8601String(),
                ];
            })->values()->all();

        $openGlobal = BugReport::query()->where('status', 'open')->count();

        return response()->json([
            'ok' => true,
            'days' => $days,
            'since' => $since->toIso8601String(),
            'totals' => [
                'reported_in_period' => $totalReported,
                'open_in_period' => $openInPeriod,
                'resolved_in_period' => $resolvedInPeriod,
                'open_global' => $openGlobal,
            ],
            'avg_resolution_hours' => $avgResolutionHours,
            'by_software' => $bySoftware,
            'recent' => $recent,
        ]);
    }

    public function resolve(Request $request, int $id): JsonResponse
    {
        if (! Schema::hasTable('bug_reports')) {
            return response()->json([
                'ok' => false,
                'error' => 'Registro de bugs no disponible.',
            ], 503);
        }

        $bug = BugReport::query()->find($id);
        if (! $bug) {
            return response()->json(['ok' => false, 'error' => 'Caso no encontrado.'], 404);
        }

        if ($bug->status === 'resolved') {
            return response()->json([
                'ok' => true,
                'already_resolved' => true,
                'ticket_code' => $bug->ticket_code,
            ]);
        }

        $bug->status = 'resolved';
        $bug->resolved_at = now();
        $bug->save();

        return response()->json([
            'ok' => true,
            'ticket_code' => $bug->ticket_code,
            'resolved_at' => $bug->resolved_at?->toIso8601String(),
        ]);
    }

    private function makeUniqueTicketCode(): string
    {
        for ($i = 0; $i < 8; $i++) {
            $code = 'WB-'.now()->format('Ymd').'-'.strtoupper(bin2hex(random_bytes(3)));
            if (! BugReport::query()->where('ticket_code', $code)->exists()) {
                return $code;
            }
        }

        return 'WB-'.now()->format('Ymd').'-'.strtoupper(Str::random(8));
    }

    private function visitorHash(Request $request): string
    {
        $key = (string) config('app.key', 'WorkColbeef');
        $ip = (string) $request->ip();
        $ua = substr((string) $request->userAgent(), 0, 512);

        $secret = Str::startsWith($key, 'base64:')
            ? base64_decode(substr($key, 7), true) ?: $key
            : $key;

        return substr(hash_hmac('sha256', $ip.'|'.$ua, $secret), 0, 32);
    }
}
