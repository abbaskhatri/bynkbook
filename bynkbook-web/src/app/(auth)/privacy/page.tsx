export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">Privacy Policy</h1>
        <p className="text-sm text-slate-600">Last updated: {new Date().toISOString().slice(0, 10)}</p>

        <div className="prose prose-slate max-w-none">
          <p>
            This page describes how BynkBook handles data in the app. For questions, contact support.
          </p>
          <ul>
            <li>We use authentication to protect your account.</li>
            <li>Business data is scoped to your organization.</li>
            <li>Access is controlled by roles and permissions.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
