<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bug_reports', function (Blueprint $table) {
            $table->string('requester_name', 120)->nullable()->after('ticket_code');
            $table->string('requester_email', 190)->nullable()->after('requester_name');
        });
    }

    public function down(): void
    {
        Schema::table('bug_reports', function (Blueprint $table) {
            $table->dropColumn(['requester_name', 'requester_email']);
        });
    }
};
