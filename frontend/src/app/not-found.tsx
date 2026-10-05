import Link from "next/link";
import { Brand } from "@/components/app-shell";

export default function NotFound() {
  return (
    <main className="access-gate">
      <section className="access-gate-card">
        <Brand />
        <p className="not-found-code">404</p>
        <h1>Сторінку не знайдено</h1>
        <p>Перевірте адресу або поверніться до своїх пристроїв.</p>
        <div className="access-gate-actions">
          <Link className="button button-primary" href="/devices">
            До пристроїв
          </Link>
          <Link className="button button-secondary" href="/login">
            До входу
          </Link>
        </div>
      </section>
    </main>
  );
}
