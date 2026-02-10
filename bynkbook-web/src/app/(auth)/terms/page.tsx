export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-6 py-10 space-y-4">
        <h1 className="text-xl font-semibold text-slate-900">Terms of Service</h1>
        <p className="text-sm text-slate-600">Last updated: {new Date().toISOString().slice(0, 10)}</p>

        <div className="prose prose-slate max-w-none">
          <p>
            These terms govern use of the BynkBook application. For questions, contact support.
          </p>
          <ul>
            <li>You are responsible for maintaining access to your account.</li>
            <li>Do not upload illegal or unauthorized content.</li>
            <li>Use of the service is subject to applicable laws.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
