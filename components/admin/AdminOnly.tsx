'use client';

import Link from 'next/link';
import { useStaffRole } from './useStaffRole';

/**
 * Shows its children to admins only; staff see a plain "ask an admin"
 * message. The server routes behind these pages enforce the same rule.
 */
export default function AdminOnly({ title, children }: { title: string; children: React.ReactNode }) {
  const { role, loading } = useStaffRole();

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading...</div>;
  }

  if (role !== 'admin') {
    return (
      <div className="max-w-xl mx-auto mt-12 bg-white border border-gray-200 rounded-xl p-8 text-center">
        <i className="ri-shield-keyhole-line text-4xl text-gray-400"></i>
        <h1 className="text-xl font-bold text-gray-900 mt-3">{title}</h1>
        <p className="text-gray-600 mt-2">
          This page is for admins only. Ask an admin if something here needs changing.
        </p>
        <Link href="/admin" className="inline-block mt-6 text-sm font-semibold text-blue-700 hover:underline">
          Back to the dashboard
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
