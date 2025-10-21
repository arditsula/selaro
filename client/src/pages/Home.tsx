import { useState } from 'react';
import Hero from '@/components/Hero';
import HowItWorks from '@/components/HowItWorks';
import DashboardPreview from '@/components/DashboardPreview';
import ConnectClinic from '@/components/ConnectClinic';
import CallSimulationModal from '@/components/CallSimulationModal';
import Footer from '@/components/Footer';

export default function Home() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="min-h-screen">
      <Hero onSimulateCall={() => setIsModalOpen(true)} />
      <HowItWorks />
      <DashboardPreview />
      <ConnectClinic />
      <Footer />
      <CallSimulationModal open={isModalOpen} onOpenChange={setIsModalOpen} />
    </div>
  );
}
