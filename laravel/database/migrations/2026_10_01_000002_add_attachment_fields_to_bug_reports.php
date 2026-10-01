<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bug_reports', function (Blueprint $table) {
            $table->string('attachment_path', 255)->nullable()->after('mensaje');
            $table->string('attachment_name', 255)->nullable()->after('attachment_path');
            $table->string('attachment_mime', 100)->nullable()->after('attachment_name');
        });
    }

    public function down(): void
    {
        Schema::table('bug_reports', function (Blueprint $table) {
            $table->dropColumn(['attachment_path', 'attachment_name', 'attachment_mime']);
        });
    }
};
