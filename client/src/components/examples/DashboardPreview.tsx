import DashboardPreview, { type CallLog } from '../DashboardPreview';

const mockLogs: CallLog[] = [
  {
    id: 1,
    name: "Test Patient",
    phone: "123-456-7890",
    service: "Cleaning",
    preferredTime: "Tomorrow",
    status: "new",
    created: "Just now"
  }
];

export default function DashboardPreviewExample() {
  return <DashboardPreview callLogs={mockLogs} onRefresh={() => console.log('Refresh clicked')} />;
}
