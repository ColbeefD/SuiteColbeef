<?php

namespace App\Http\Controllers;

use App\Models\BugReport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

/**
 * Gestión de reportes de bugs / PQR del portal.
 *
 * store()        → alta pública (throttle): crea un ticket WB-YYYYMMDD-XXXXXX
 *                  y lo notifica automáticamente por SMTP.
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
        'control-operativo' => 'Control operativo (módulo)',
        'control-operativo-app' => 'Control operativo (aplicación)',
        'validador-od' => 'Validador OD',
        'gestion-humana' => 'Gestión humana',
        'contratista' => 'Contratista',
        'logistica' => 'Logística (módulo)',
        'desposte' => 'Desposte',
        'inventarios' => 'Inventarios',
        'app-logistica' => 'App Logística',
        'rendimientos' => 'Rendimientos',
        'lenguas' => 'Lenguas',
        'calidad' => 'Calidad (módulo)',
        'canales' => 'Canales',
        'colbeef-ops' => 'Colbeef-Ops',
        'tesoreria-cartera' => 'Tesorería y cartera (módulo)',
        'pago-proveedores' => 'Pago proveedores',
        'administrativo' => 'Administrativo (módulo)',
        'juricombeef' => 'Juricombeef',
        'contabilidad' => 'Contabilidad',
        'power-bi' => 'Power BI (módulo)',
        'datos-cifras' => 'Datos y cifras Colbeef',
        'control-pqrs' => 'Control PQRS',
        'analyzer' => 'Analyzer',
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
            'requester_name' => 'required|string|min:2|max:120',
            'requester_email' => 'required|string|email:rfc|max:190',
            'software' => 'required|string|in:'.$softwareKeys,
            'tema' => 'required|string|max:120',
            'detalle' => 'required|string|max:200',
            'mensaje' => 'required|string|min:10|max:8000',
            'attachment' => 'nullable|file|image|mimes:jpg,jpeg,png,webp|max:5120',
        ]);

        $ticketCode = $this->makeUniqueTicketCode();
        $attachment = $request->file('attachment');
        $attachmentPath = null;
        $attachmentName = null;
        $attachmentMime = null;

        if ($attachment) {
            $extension = Str::lower($attachment->extension() ?: 'jpg');
            $attachmentPath = $attachment->storeAs('bug-reports', $ticketCode.'.'.$extension, 'local');
            if (! $attachmentPath) {
                return response()->json([
                    'ok' => false,
                    'error' => 'No se pudo guardar la captura. Intenta nuevamente.',
                ], 500);
            }
            $attachmentName = Str::limit(
                str_replace(["\r", "\n", "\0"], '', basename($attachment->getClientOriginalName())),
                255,
                ''
            );
            $attachmentMime = $attachment->getMimeType();
        }

        try {
            $row = BugReport::query()->create([
                'ticket_code' => $ticketCode,
                'requester_name' => trim($validated['requester_name']),
                'requester_email' => Str::lower(trim($validated['requester_email'])),
                'software' => $validated['software'],
                'tema' => $validated['tema'],
                'detalle' => $validated['detalle'],
                'mensaje' => $validated['mensaje'],
                'attachment_path' => $attachmentPath,
                'attachment_name' => $attachmentName,
                'attachment_mime' => $attachmentMime,
                'status' => 'open',
                'visitor_hash' => $this->visitorHash($request),
            ]);
        } catch (Throwable $exception) {
            if ($attachmentPath) {
                Storage::disk('local')->delete($attachmentPath);
            }
            throw $exception;
        }

        $softwareLabel = self::SOFTWARE_LABELS[$row->software] ?? $row->software;
        $emailSent = $this->sendReportEmail($row, $softwareLabel);

        return response()->json([
            'ok' => true,
            'ticket_code' => $row->ticket_code,
            'reported_at' => $row->created_at?->toIso8601String(),
            'software_label' => $softwareLabel,
            'email_sent' => $emailSent,
            'email_warning' => $emailSent ? null : 'El caso quedó registrado, pero no se pudo enviar el correo automático.',
        ], 201);
    }

    private function sendReportEmail(BugReport $report, string $softwareLabel): bool
    {
        $recipients = array_values(array_filter(
            array_map('trim', explode(',', (string) config('mail.bug_report_to', ''))),
            fn (string $email) => filter_var($email, FILTER_VALIDATE_EMAIL) !== false
        ));
        if ($recipients === []) {
            return false;
        }

        $subjectTema = str_replace(["\r", "\n"], ' ', $report->tema);
        $subjectDetalle = str_replace(["\r", "\n"], ' ', $report->detalle);
        $subject = "[WorkColbeef] {$subjectTema} — {$subjectDetalle} [{$report->ticket_code}]";

        $body = implode("\n", [
            'Nuevo reporte de bugs / PQR registrado en WorkColbeef',
            '',
            'ID del caso: '.$report->ticket_code,
            'Fecha y hora: '.($report->created_at?->toIso8601String() ?? 'No disponible'),
            'Solicitante: '.$report->requester_name,
            'Correo para responder: '.$report->requester_email,
            'Software o módulo: '.$softwareLabel,
            'Tema: '.$report->tema,
            'Detalle: '.$report->detalle,
            'Captura adjunta: '.($report->attachment_path ? ($report->attachment_name ?: 'Sí') : 'No'),
            '',
            'Descripción:',
            $report->mensaje,
            '',
            'Estado inicial: Abierto',
            '',
            'Este mensaje fue enviado automáticamente por WorkColbeef.',
        ]);

        try {
            Mail::raw($body, function ($message) use ($recipients, $subject, $report) {
                $message
                    ->to($recipients)
                    ->replyTo($report->requester_email, $report->requester_name)
                    ->subject($subject);

                if ($report->attachment_path && Storage::disk('local')->exists($report->attachment_path)) {
                    $options = [
                        'as' => $report->attachment_name ?: basename($report->attachment_path),
                    ];
                    if ($report->attachment_mime) {
                        $options['mime'] = $report->attachment_mime;
                    }
                    $message->attach(Storage::disk('local')->path($report->attachment_path), $options);
                }
            });

            return true;
        } catch (Throwable $exception) {
            report($exception);

            return false;
        }
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
                    'requester_name' => $b->requester_name,
                    'requester_email' => $b->requester_email,
                    'tema' => $b->tema,
                    'detalle' => $b->detalle,
                    'mensaje' => $b->mensaje,
                    'has_attachment' => filled($b->attachment_path),
                    'attachment_url' => filled($b->attachment_path)
                        ? '/api/admin/bugs/'.$b->id.'/attachment'
                        : null,
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
        $notificationSent = $this->sendResolvedEmail($bug);

        return response()->json([
            'ok' => true,
            'ticket_code' => $bug->ticket_code,
            'resolved_at' => $bug->resolved_at?->toIso8601String(),
            'notification_sent' => $notificationSent,
            'notification_warning' => $notificationSent
                ? null
                : 'El caso quedó resuelto, pero no se pudo enviar el correo al solicitante.',
        ]);
    }

    public function attachment(int $id)
    {
        $bug = BugReport::query()->find($id);
        if (! $bug || ! $bug->attachment_path || ! Storage::disk('local')->exists($bug->attachment_path)) {
            abort(404);
        }

        return Storage::disk('local')->response(
            $bug->attachment_path,
            $bug->attachment_name ?: basename($bug->attachment_path),
            ['Content-Type' => $bug->attachment_mime ?: 'application/octet-stream'],
            'inline'
        );
    }

    private function sendResolvedEmail(BugReport $report): bool
    {
        if (! $report->requester_email) {
            return false;
        }

        $softwareLabel = self::SOFTWARE_LABELS[$report->software] ?? $report->software;
        $subject = '[WorkColbeef] Caso solucionado ['.$report->ticket_code.']';
        $body = implode("\n", [
            'Hola '.$report->requester_name.',',
            '',
            'Tu solicitud fue marcada como solucionada por Desarrollo y Tecnología.',
            '',
            'ID del caso: '.$report->ticket_code,
            'Software o módulo: '.$softwareLabel,
            'Tema: '.$report->tema,
            'Detalle: '.$report->detalle,
            'Fecha de solución: '.($report->resolved_at?->toIso8601String() ?? now()->toIso8601String()),
            '',
            'Descripción original:',
            $report->mensaje,
            '',
            'Si el inconveniente continúa, responde a este correo indicando el ID del caso.',
            '',
            'Este mensaje fue enviado automáticamente por WorkColbeef.',
        ]);

        try {
            Mail::raw($body, function ($message) use ($report, $subject) {
                $message->to($report->requester_email, $report->requester_name)->subject($subject);
            });

            return true;
        } catch (Throwable $exception) {
            report($exception);

            return false;
        }
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
