import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import type { CallLog } from "@shared/schema";

interface DashboardPreviewProps {
  callLogs: CallLog[];
  onRefresh: () => void;
  isRefreshing?: boolean;
}

const statusConfig = {
  New: { label: "New", className: "bg-[#DBEAFE] text-[#1E40AF] border-[#BFDBFE]" },
  Called: { label: "Called", className: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]" },
  Booked: { label: "Booked", className: "bg-[#D1FAE5] text-[#065F46] border-[#A7F3D0]" },
};

function formatCreatedAt(createdAt: string): string {
  const date = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

export default function DashboardPreview({ callLogs = [], onRefresh, isRefreshing = false }: DashboardPreviewProps) {
  return (
    <section id="dashboard-preview" className="py-32 px-6 bg-[#F9FAFB]">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-5xl md:text-6xl font-bold text-[#111827]">
              Dashboard Preview
            </h2>
            <p className="text-[#6B7280] mt-2 text-xl font-light">
              See all patient interactions in one place
            </p>
          </div>
          <Button 
            onClick={onRefresh}
            disabled={isRefreshing}
            className="gap-2 bg-[#00C896] hover:bg-[#00B386] text-white shadow-lg disabled:opacity-50"
            data-testid="button-refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        
        <div className="bg-white rounded-3xl border border-[#E5E7EB] shadow-xl overflow-hidden mt-12">
          <div className="overflow-x-auto">
            <table className="w-full" data-testid="table-calls">
              <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                <tr>
                  <th className="px-8 py-5 text-left text-sm font-semibold uppercase tracking-wider text-[#6B7280]">Name</th>
                  <th className="px-8 py-5 text-left text-sm font-semibold uppercase tracking-wider text-[#6B7280]">Phone</th>
                  <th className="px-8 py-5 text-left text-sm font-semibold uppercase tracking-wider text-[#6B7280]">Service</th>
                  <th className="px-8 py-5 text-left text-sm font-semibold uppercase tracking-wider text-[#6B7280]">Preferred Time</th>
                  <th className="px-8 py-5 text-left text-sm font-semibold uppercase tracking-wider text-[#6B7280]">Status</th>
                  <th className="px-8 py-5 text-left text-sm font-semibold uppercase tracking-wider text-[#6B7280]">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {callLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-8 py-12 text-center text-[#9CA3AF]">
                      No calls logged yet. Try the "Simulate a Call" demo above!
                    </td>
                  </tr>
                ) : (
                  callLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-[#F9FAFB] transition-colors" data-testid={`row-call-${log.id}`}>
                      <td className="px-8 py-5 font-medium text-[#111827]" data-testid={`text-name-${log.id}`}>{log.name}</td>
                      <td className="px-8 py-5 text-[#6B7280]">{log.phone}</td>
                      <td className="px-8 py-5 text-[#111827]">{log.service}</td>
                      <td className="px-8 py-5 text-[#6B7280]">{log.preferredTime}</td>
                      <td className="px-8 py-5">
                        <Badge variant="outline" className={statusConfig[log.status].className} data-testid={`badge-status-${log.id}`}>
                          {statusConfig[log.status].label}
                        </Badge>
                      </td>
                      <td className="px-8 py-5 text-[#9CA3AF] text-sm">{formatCreatedAt(log.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
