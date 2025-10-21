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
    color: "text-red-500"
  },
  {
    id: 'faq',
    icon: FileText,
    title: "Upload FAQ",
    description: "Train the AI with your clinic's information",
    color: "text-blue-500"
  },
  {
    id: 'whatsapp',
    icon: MessageCircle,
    title: "Enable WhatsApp",
    description: "Allow patients to message your AI receptionist",
    color: "text-green-500"
  }
];

export default function ConnectClinic() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-4xl md:text-5xl font-bold text-center mb-4">
          Connect Your Clinic
        </h2>
        <p className="text-center text-muted-foreground mb-12 text-lg">
          Quick setup to get your AI receptionist running
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {integrations.map((integration) => (
            <Card key={integration.id} className="p-8 relative overflow-hidden">
              <Badge 
                variant="outline" 
                className="absolute top-4 right-4 bg-yellow-500/10 text-yellow-600 border-yellow-500/20"
              >
                Coming Soon
              </Badge>
              
              <div className={`w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-6 ${integration.color}`}>
                <integration.icon className="w-8 h-8" />
              </div>
              
              <h3 className="text-xl font-semibold mb-3">
                {integration.title}
              </h3>
              
              <p className="text-muted-foreground mb-6">
                {integration.description}
              </p>
              
              <Button 
                className="w-full" 
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
