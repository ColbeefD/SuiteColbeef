<?php

namespace App\Http\Controllers;

use App\Models\UsageEvent;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Registro y agregación de métricas de uso del portal.
 *
 * record()  → endpoint público (throttle) que persiste un evento por cada
 *             page_view / module_click / search_open / chat_open / chat_message,
 *             incluyendo el módulo (app_id) y el programa específico
 *             (program_id/program_label). El visitante se anonimiza con un hash.
 * summary() → endpoint admin que devuelve totales y desgloses por módulo
 *             (by_app), por programa (by_program) y por día (daily).
 *
 * Nota: user_label existe en la tabla pero se persiste NULL a propósito (las
 * estadísticas se agregan por módulo/programa, no por usuario).
 *
 * @see \App\Models\UsageEvent
 */
class UsageStatsController extends Controller
{
    private const EVENTS = [
        'page_view',
        'module_click',
        'search_open',
        'chat_open',
        'chat_message',
    ];

    private const APP_LABELS = [
        'control-operativo' => 'Control operativo',
        'gestion-humana' => 'Gestión humana',
        'logistica' => 'Logística',
        'calidad' => 'Calidad',
        'tesoreria-cartera' => 'Tesorería y cartera',
        'power-bi' => 'Power BI',
    ];

    public function record(Request $request)
    {
        if (! Schema::hasTable('usage_events')) {
            return response()->json([
                'ok' => false,
                'error' => 'Estadísticas no disponibles. Ejecuta: php artisan migrate',
            ], 503);
        }

        $validated = $request->validate([
            'event' => 'required|string|in:'.implode(',', self::EVENTS),
            'app_id' => 'nullable|string|max:96',
            'program_id' => 'nullable|string|max:160',
            'program_label' => 'nullable|string|max:160',
            'user_label' => 'nullable|string|max:160',
        ]);

        $visitorHash = $this->visitorHash($request);

        UsageEvent::query()->create([
            'event' => $validated['event'],
            'app_id' => $this->cleanStatText($validated['app_id'] ?? null),
            'program_id' => $this->cleanStatText($validated['program_id'] ?? null),
            'program_label' => $this->cleanStatText($validated['program_label'] ?? null),
            'visitor_hash' => $visitorHash,
            'user_label' => null,
            'created_at' => now(),
        ]);

        return response()->json(['ok' => true]);
    }

    public function summary(Request $request)
    {
        if (! Schema::hasTable('usage_events')) {
            return response()->json([
                'ok' => false,
                'error' => 'Estadísticas no disponibles. Ejecuta: php artisan migrate',
            ], 503);
        }

        $days = (int) $request->query('days', 7);
        if ($days < 1) {
            $days = 1;
        }
        if ($days > 90) {
            $days = 90;
        }

        $since = now()->subDays($days)->startOfDay();

        $totalsRaw = UsageEvent::query()
            ->where('created_at', '>=', $since)
            ->selectRaw('event, COUNT(*) as c')
            ->groupBy('event')
            ->pluck('c', 'event')
            ->all();

        $totals = [];
        foreach (self::EVENTS as $ev) {
            $totals[$ev] = (int) ($totalsRaw[$ev] ?? 0);
        }

        $byAppRows = UsageEvent::query()
            ->where('created_at', '>=', $since)
            ->where('event', 'module_click')
            ->whereNotNull('app_id')
            ->selectRaw('app_id, COUNT(*) as c')
            ->groupBy('app_id')
            ->orderByDesc('c')
            ->get();

        $byApp = $byAppRows->map(function ($row) {
            $id = $row->app_id;

            return [
                'app_id' => $id,
                'label' => self::APP_LABELS[$id] ?? $id,
                'clicks' => (int) $row->c,
            ];
        })->values()->all();

        $byProgramRows = UsageEvent::query()
            ->where('created_at', '>=', $since)
            ->where('event', 'module_click')
            ->whereNotNull('program_id')
            ->selectRaw('program_id, MAX(program_label) as program_label, MAX(app_id) as app_id, COUNT(*) as c')
            ->groupBy('program_id')
            ->orderByDesc('c')
            ->limit(30)
            ->get();

        $byProgram = $byProgramRows->map(function ($row) {
            return [
                'program_id' => $row->program_id,
                'label' => $row->program_label ?: $row->program_id,
                'app_id' => $row->app_id,
                'module_label' => self::APP_LABELS[$row->app_id] ?? $row->app_id,
                'clicks' => (int) $row->c,
            ];
        })->values()->all();

        $dateExpr = $this->dateExpression();
        $dailyRows = UsageEvent::query()
            ->where('created_at', '>=', $since)
            ->select(DB::raw("{$dateExpr} as d"), DB::raw('COUNT(*) as c'))
            ->groupBy(DB::raw($dateExpr))
            ->orderBy('d')
            ->get();

        $daily = $dailyRows->map(function ($row) {
            return [
                'date' => $row->d,
                'events' => (int) $row->c,
            ];
        })->values()->all();

        $uniqueVisitors = (int) (DB::table('usage_events')
            ->where('created_at', '>=', $since)
            ->whereNotNull('visitor_hash')
            ->where('visitor_hash', '!=', '')
            ->selectRaw('COUNT(DISTINCT visitor_hash) as agg')
            ->value('agg') ?? 0);

        return response()->json([
            'ok' => true,
            'days' => $days,
            'since' => $since->toIso8601String(),
            'totals' => $totals,
            'unique_visitors_estimate' => $uniqueVisitors,
            'by_app' => $byApp,
            'by_program' => $byProgram,
            'daily' => $daily,
        ]);
    }

    private function cleanStatText(?string $value): ?string
    {
        $text = trim((string) $value);

        return $text === '' ? null : Str::limit($text, 160, '');
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

    private function dateExpression(): string
    {
        $driver = DB::connection()->getDriverName();

        return match ($driver) {
            'sqlite' => "date(created_at)",
            default => 'DATE(created_at)',
        };
    }
}
