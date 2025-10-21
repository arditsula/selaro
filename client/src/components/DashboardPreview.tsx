import { Badge } from "@/components/ui/badge";

interface CallLog {
  id: number;
  name: string;
  phone: string;
  service: string;
  preferredTime: string;
  status: 'pending' | 'scheduled' | 'contacted';
  created: string;
}

const mockCallLogs: CallLog[] = [
  {
    id: 1,
    name: "Sarah Johnson",
    phone: "(555) 234-5678",
    service: "Teeth Cleaning",
    preferredTime: "Tomorrow 2-4 PM",
    status: "scheduled",
    created: "2 hours ago"
  },
  {
    id: 2,
    name: "Michael Chen",
    phone: "(555) 876-5432",
    service: "Emergency Toothache",
    preferredTime: "ASAP",
    status: "contacted",
    created: "3 hours ago"
  },
  {
    id: 3,
    name: "Emily Rodriguez",
    phone: "(555) 345-6789",
    service: "Dental Crown",
    preferredTime: "Next Week Mon/Tue",
    status: "pending",
    created: "5 hours ago"
  },
  {
    id: 4,
    name: "James Wilson",
    phone: "(555) 456-7890",
    service: "Whitening Consultation",
    preferredTime: "Friday Morning",
    status: "scheduled",
    created: "1 day ago"
  },
  {
    id: 5,
    name: "Lisa Anderson",
    phone: "(555) 567-8901",
    service: "Root Canal",
    preferredTime: "This Week Afternoon",
    status: "pending",
    created: "1 day ago"
  }
];

const statusConfig = {
  pending: { label: "Pending", className: "bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]" },
  scheduled: { label: "Scheduled", className: "bg-[#D1FAE5] text-[#065F46] border-[#A7F3D0]" },
  contacted: { label: "Contacted", className: "bg-[#DBEAFE] text-[#1E40AF] border-[#BFDBFE]" }
};

export default function DashboardPreview() {
  return (
    <section id="dashboard-preview" className="py-32 px-6 bg-[#F9FAFB]">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-5xl md:text-6xl font-bold text-center mb-6 text-[#111827]">
          Dashboard Preview
        </h2>
        <p className="text-center text-[#6B7280] mb-16 text-xl font-light">
          See all patient interactions in one place
        </p>
        
        <div className="bg-white rounded-3xl border border-[#E5E7EB] shadow-xl overflow-hidden">
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
                {mockCallLogs.map((log) => (
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
                    <td className="px-8 py-5 text-[#9CA3AF] text-sm">{log.created}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
