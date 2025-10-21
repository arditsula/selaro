import { Button } from "@/components/ui/button";
import { Phone, LayoutDashboard } from "lucide-react";
import heroImage from "@assets/generated_images/Dental_clinic_hero_background_16079e81.png";

interface HeroProps {
  onSimulateCall: () => void;
}

export default function Hero({ onSimulateCall }: HeroProps) {
  const scrollToDashboard = () => {
    document.getElementById('dashboard-preview')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      <div 
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `url(${heroImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900/95 via-slate-900/90 to-blue-900/85" />
      </div>
      
      <div className="relative z-10 max-w-5xl mx-auto px-6 py-24 text-center">
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-6">
          Your 24/7 AI Receptionist for Dental Clinics
        </h1>
        
        <p className="text-lg md:text-xl text-blue-100 max-w-2xl mx-auto mb-12 leading-relaxed">
          Never miss a patient call again. Our AI receptionist handles appointments, 
          answers questions, and logs every interaction—even after hours.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Button 
            size="lg"
            className="gap-2 text-lg px-8 py-6"
            onClick={onSimulateCall}
            data-testid="button-simulate-call"
          >
            <Phone className="w-5 h-5" />
            Simulate a Call
          </Button>
          
          <Button 
            size="lg"
            variant="outline"
            className="gap-2 text-lg px-8 py-6 bg-white/10 backdrop-blur-sm border-white/20 text-white hover:bg-white/20"
            onClick={scrollToDashboard}
            data-testid="button-dashboard-preview"
          >
            <LayoutDashboard className="w-5 h-5" />
            See Dashboard Preview
          </Button>
        </div>
      </div>
    </section>
  );
}
