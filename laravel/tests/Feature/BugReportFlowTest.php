<?php

namespace Tests\Feature;

use App\Http\Middleware\VerifyAdminJwt;
use App\Models\BugReport;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class BugReportFlowTest extends TestCase
{
    use RefreshDatabase;

    public function test_report_with_private_screenshot_can_be_reviewed_and_resolved(): void
    {
        Storage::fake('local');
        config([
            'mail.default' => 'array',
            'mail.bug_report_to' => 'desarrollo@example.test, coordinacion@example.test',
        ]);

        $png = base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            true
        );

        $create = $this->post('/api/bugs/report', [
            'requester_name' => 'Usuario de prueba',
            'requester_email' => 'usuario@example.test',
            'software' => 'WorkColbeef-portal',
            'tema' => 'Error o fallo',
            'detalle' => 'Pantalla en blanco',
            'mensaje' => 'Descripción completa del incidente.',
            'attachment' => UploadedFile::fake()->createWithContent('captura.png', $png),
        ]);

        $create->assertCreated()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('email_sent', true);

        $reportEmail = app('mailer')->getSymfonyTransport()->messages()->first()->getOriginalMessage();
        $this->assertCount(2, $reportEmail->getTo());

        $report = BugReport::query()->sole();
        $this->assertNotNull($report->attachment_path);
        Storage::disk('local')->assertExists($report->attachment_path);

        $this->withoutMiddleware(VerifyAdminJwt::class)
            ->get('/api/admin/bugs/'.$report->id.'/attachment')
            ->assertOk()
            ->assertHeader('content-type', 'image/png');

        $this->withoutMiddleware(VerifyAdminJwt::class)
            ->patch('/api/admin/bugs/'.$report->id.'/resolve')
            ->assertOk()
            ->assertJsonPath('notification_sent', true);

        $this->assertSame('resolved', $report->fresh()->status);
    }
}
