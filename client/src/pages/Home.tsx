import { useState } from 'react';
import Hero from '@/components/Hero';
import HowItWorks from '@/components/HowItWorks';
import DashboardPreview, { type CallLog } from '@/components/DashboardPreview';
import ConnectClinic from '@/components/ConnectClinic';
import CallSimulationModal from '@/components/CallSimulationModal';
import Footer from '@/components/Footer';
import { useToast } from '@/hooks/use-toast';

const initialCallLogs: CallLog[] = [
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

export default function Home() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [callLogs, setCallLogs] = useState<CallLog[]>(initialCallLogs);
  const [nextId, setNextId] = useState(6);
  const { toast } = useToast();

  const handleLogCall = (callData: {
    name: string;
    phone: string;
    service: string;
    preferredTime: string;
  }) => {
    const newLog: CallLog = {
      id: nextId,
      ...callData,
      status: 'new',
      created: 'Just now'
    };
    
    setCallLogs([newLog, ...callLogs]);
    setNextId(nextId + 1);
    
    toast({
      title: "Sent to clinic (demo)",
      description: `Call from ${callData.name} has been logged.`,
      duration: 3000,
    });
  };

  const handleRefresh = () => {
    console.log('Dashboard refreshed');
    toast({
      title: "Dashboard refreshed",
      description: "Showing latest call logs",
      duration: 2000,
    });
  };

  return (
    <div className="min-h-screen">
      <Hero onSimulateCall={() => setIsModalOpen(true)} />
      <HowItWorks />
      <DashboardPreview callLogs={callLogs} onRefresh={handleRefresh} />
      <ConnectClinic />
      <Footer />
      <CallSimulationModal 
        open={isModalOpen} 
        onOpenChange={setIsModalOpen}
        onLogCall={handleLogCall}
      />
    </div>
  );
}
