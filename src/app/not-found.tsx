import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6 text-center">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Page not found</h1>
        <p className="mt-2 text-slate-600">The page you are looking for does not exist.</p>
        <Link href="/" className="mt-4 inline-block font-semibold text-brand-700">
          Go home
        </Link>
      </div>
    </div>
  );
}
