import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Phone, FileText, MessageCircle } from "lucide-react";

const integrations = [
  {
    id: 'twilio',
    icon: Phone,
    title: "Connect Twilio",
    description: "Link your phone number to receive calls",
    color: "text-[#00C896]"
  },
  {
    id: 'faq',
    icon: FileText,
    title: "Upload FAQ",
    description: "Train the AI with your clinic's information",
    color: "text-[#00C896]"
  },
  {
    id: 'whatsapp',
    icon: MessageCircle,
    title: "Enable WhatsApp",
    description: "Allow patients to message your AI receptionist",
    color: "text-[#00C896]"
  }
];

export default function ConnectClinic() {
  return (
    <section className="py-32 px-6 bg-white">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-5xl md:text-6xl font-bold text-center mb-6 text-[#111827]">
          Connect Your Clinic
        </h2>
        <p className="text-center text-[#6B7280] mb-16 text-xl font-light">
          Quick setup to get your AI receptionist running
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {integrations.map((integration) => (
            <Card key={integration.id} className="p-10 relative overflow-hidden shadow-lg border-[#E5E7EB] bg-white">
              <Badge 
                variant="outline" 
                className="absolute top-6 right-6 bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]"
              >
                Coming Soon
              </Badge>
              
              <div className={`w-16 h-16 rounded-2xl bg-[#ECFDF5] flex items-center justify-center mb-8 ${integration.color}`}>
                <integration.icon className="w-8 h-8" />
              </div>
              
              <h3 className="text-2xl font-semibold mb-4 text-[#111827]">
                {integration.title}
              </h3>
              
              <p className="text-[#6B7280] mb-8 text-lg">
                {integration.description}
              </p>
              
              <Button 
                className="w-full opacity-50" 
                disabled
                data-testid={`button-connect-${integration.id}`}
              >
                Connect
              </Button>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
