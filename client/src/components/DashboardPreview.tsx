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
  pending: { label: "Pending", className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20" },
  scheduled: { label: "Scheduled", className: "bg-green-500/10 text-green-600 border-green-500/20" },
  contacted: { label: "Contacted", className: "bg-blue-500/10 text-blue-600 border-blue-500/20" }
};

export default function DashboardPreview() {
  return (
    <section id="dashboard-preview" className="py-24 px-6 bg-card">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-4xl md:text-5xl font-bold text-center mb-4">
          Dashboard Preview
        </h2>
        <p className="text-center text-muted-foreground mb-12 text-lg">
          See all patient interactions in one place
        </p>
        
        <div className="bg-background rounded-2xl border shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full" data-testid="table-calls">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider">Name</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider">Phone</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider">Service</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider">Preferred Time</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold uppercase tracking-wider">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {mockCallLogs.map((log, index) => (
                  <tr key={log.id} className={index % 2 === 0 ? 'bg-background' : 'bg-muted/20'} data-testid={`row-call-${log.id}`}>
                    <td className="px-6 py-4 font-medium" data-testid={`text-name-${log.id}`}>{log.name}</td>
                    <td className="px-6 py-4 text-muted-foreground">{log.phone}</td>
                    <td className="px-6 py-4">{log.service}</td>
                    <td className="px-6 py-4">{log.preferredTime}</td>
                    <td className="px-6 py-4">
                      <Badge variant="outline" className={statusConfig[log.status].className} data-testid={`badge-status-${log.id}`}>
                        {statusConfig[log.status].label}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground text-sm">{log.created}</td>
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
