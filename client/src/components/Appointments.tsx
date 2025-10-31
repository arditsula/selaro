import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { insertAppointmentSchema, type Appointment } from '@shared/schema';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Calendar, Clock, Phone, User, Trash2, Check, X, Filter } from 'lucide-react';

type FilterType = 'all' | 'today' | 'week';

const formSchema = insertAppointmentSchema.extend({
  name: z.string().min(1, 'Name is required'),
  phone: z.string().min(1, 'Phone is required'),
  service: z.string().min(1, 'Service is required'),
  datetime: z.string().min(1, 'Date and time are required'),
});

export default function Appointments() {
  const [filter, setFilter] = useState<FilterType>('all');
  const { toast } = useToast();

  const { data: appointmentsData, isLoading } = useQuery({
    queryKey: ['/api/appointments'],
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      phone: '',
      service: '',
      datetime: '',
      notes: '',
    },
  });

  const createMutation = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      return apiRequest('POST', '/api/appointments', values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/appointments'] });
      form.reset();
      toast({
        title: 'Appointment created',
        description: 'The appointment has been scheduled successfully.',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to create appointment. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return apiRequest('PATCH', `/api/appointments/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/appointments'] });
      toast({
        title: 'Status updated',
        description: 'Appointment status has been updated.',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/appointments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/appointments'] });
      toast({
        title: 'Appointment deleted',
        description: 'The appointment has been removed.',
      });
    },
  });

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    createMutation.mutate(values);
  };

  const appointments = (appointmentsData as { appointments?: Appointment[] })?.appointments || [];

  const filterAppointments = (appointments: Appointment[]) => {
    if (filter === 'all') return appointments;
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekFromNow = new Date(today);
    weekFromNow.setDate(weekFromNow.getDate() + 7);

    return appointments.filter(apt => {
      if (!apt.datetime) return false;
      const aptDate = new Date(apt.datetime);
      
      if (filter === 'today') {
        return aptDate.getFullYear() === today.getFullYear() &&
               aptDate.getMonth() === today.getMonth() &&
               aptDate.getDate() === today.getDate();
      }
      
      if (filter === 'week') {
        const aptDay = new Date(aptDate.getFullYear(), aptDate.getMonth(), aptDate.getDate());
        return aptDay >= today && aptDay < weekFromNow;
      }
      
      return true;
    });
  };

  const filteredAppointments = filterAppointments(appointments);

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'Confirmed':
        return 'default';
      case 'Cancelled':
        return 'destructive';
      default:
        return 'secondary';
    }
  };

  const getTomorrowDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  };

  return (
    <section className="py-20 px-6 bg-gradient-to-b from-white to-mint-50/30">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Appointments
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Manage your clinic appointments. Schedule new visits and track upcoming bookings.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Schedule Appointment</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <Input 
                              placeholder="Patient name" 
                              className="pl-10" 
                              {...field} 
                              data-testid="input-appointment-name"
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <Input 
                              placeholder="+49 30 555 9999" 
                              className="pl-10" 
                              {...field} 
                              data-testid="input-appointment-phone"
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="service"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Service</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Cleaning, Checkup, etc." 
                            {...field} 
                            data-testid="input-appointment-service"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="datetime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date & Time</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <Input 
                              type="datetime-local" 
                              className="pl-10" 
                              {...field} 
                              data-testid="input-appointment-datetime"
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes (Optional)</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Additional notes..." 
                            className="resize-none" 
                            rows={3}
                            {...field} 
                            data-testid="input-appointment-notes"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button 
                    type="submit" 
                    className="w-full bg-mint-green hover:bg-mint-green/90" 
                    disabled={createMutation.isPending}
                    data-testid="button-create-appointment"
                  >
                    {createMutation.isPending ? 'Creating...' : 'Schedule Appointment'}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <CardTitle>Upcoming Appointments</CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant={filter === 'all' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilter('all')}
                    data-testid="button-filter-all"
                    className={filter === 'all' ? 'bg-mint-green hover:bg-mint-green/90' : ''}
                  >
                    All
                  </Button>
                  <Button
                    variant={filter === 'today' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilter('today')}
                    data-testid="button-filter-today"
                    className={filter === 'today' ? 'bg-mint-green hover:bg-mint-green/90' : ''}
                  >
                    Today
                  </Button>
                  <Button
                    variant={filter === 'week' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilter('week')}
                    data-testid="button-filter-week"
                    className={filter === 'week' ? 'bg-mint-green hover:bg-mint-green/90' : ''}
                  >
                    This Week
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-gray-500">Loading appointments...</div>
              ) : filteredAppointments.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No appointments found for this filter.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-2 text-sm font-medium text-gray-600">Date</th>
                        <th className="text-left py-3 px-2 text-sm font-medium text-gray-600">Time</th>
                        <th className="text-left py-3 px-2 text-sm font-medium text-gray-600">Name</th>
                        <th className="text-left py-3 px-2 text-sm font-medium text-gray-600">Phone</th>
                        <th className="text-left py-3 px-2 text-sm font-medium text-gray-600">Service</th>
                        <th className="text-left py-3 px-2 text-sm font-medium text-gray-600">Status</th>
                        <th className="text-left py-3 px-2 text-sm font-medium text-gray-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAppointments.map((apt) => {
                        const dt = apt.datetime ? new Date(apt.datetime) : null;
                        return (
                        <tr key={apt.id} className="border-b hover-elevate" data-testid={`row-appointment-${apt.id}`}>
                          <td className="py-3 px-2 text-sm" data-testid={`text-date-${apt.id}`}>
                            {dt ? dt.toLocaleDateString('de-DE') : '-'}
                          </td>
                          <td className="py-3 px-2 text-sm" data-testid={`text-time-${apt.id}`}>
                            {dt ? dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '-'}
                          </td>
                          <td className="py-3 px-2 text-sm font-medium" data-testid={`text-name-${apt.id}`}>{apt.name || '-'}</td>
                          <td className="py-3 px-2 text-sm text-gray-600" data-testid={`text-phone-${apt.id}`}>{apt.phone || '-'}</td>
                          <td className="py-3 px-2 text-sm" data-testid={`text-service-${apt.id}`}>{apt.service}</td>
                          <td className="py-3 px-2">
                            <Badge 
                              variant={getStatusBadgeVariant(apt.status)}
                              className={apt.status === 'Confirmed' ? 'bg-mint-green hover:bg-mint-green/90' : ''}
                              data-testid={`badge-status-${apt.id}`}
                            >
                              {apt.status}
                            </Badge>
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex gap-1">
                              {apt.status !== 'Confirmed' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => updateMutation.mutate({ id: apt.id, status: 'Confirmed' })}
                                  disabled={updateMutation.isPending}
                                  data-testid={`button-confirm-${apt.id}`}
                                  title="Confirm"
                                >
                                  <Check className="h-4 w-4 text-mint-green" />
                                </Button>
                              )}
                              {apt.status !== 'Cancelled' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => updateMutation.mutate({ id: apt.id, status: 'Cancelled' })}
                                  disabled={updateMutation.isPending}
                                  data-testid={`button-cancel-${apt.id}`}
                                  title="Cancel"
                                >
                                  <X className="h-4 w-4 text-red-500" />
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => deleteMutation.mutate(apt.id)}
                                disabled={deleteMutation.isPending}
                                data-testid={`button-delete-${apt.id}`}
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4 text-gray-500" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
