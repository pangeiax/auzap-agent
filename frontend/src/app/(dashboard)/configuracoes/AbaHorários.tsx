// import React, { useState, useCallback, useEffect } from "react";
// import { Loader2, Clock } from "lucide-react";
// import { Button } from "@/components/atoms/Button";
// import { Input } from "@/components/atoms/Input";
// import { useSettings } from "@/hooks/useSettings";
// import { useToast } from "@/hooks";

// const WEEKDAYS = [
//   { value: "seg", label: "Segunda" },
//   { value: "ter", label: "Terça" },
//   { value: "qua", label: "Quarta" },
//   { value: "qui", label: "Quinta" },
//   { value: "sex", label: "Sexta" },
//   { value: "sab", label: "Sábado" },
//   { value: "dom", label: "Domingo" },
// ];

// // Helper function to parse business hours from string format "HH:MM-HH:MM"
// function parseBusinessHours(
//   raw: Record<string, any> | undefined | null,
// ): Record<string, { open: string; close: string }> {
//   if (!raw) return {};

//   const parsed: Record<string, { open: string; close: string }> = {};

//   for (const [day, value] of Object.entries(raw)) {
//     if (typeof value === "string") {
//       // Format: "08:00-18:00"
//       const [open, close] = value.split("-");
//       parsed[day] = { open: open || "", close: close || "" };
//     } else if (value && typeof value === "object") {
//       // Format: { open: "08:00", close: "18:00" }
//       parsed[day] = {
//         open: (value as any).open || "",
//         close: (value as any).close || "",
//       };
//     }
//   }

//   return parsed;
// }

// export function AbaHorários() {
//   const { petshop, loadingPetshop, updatePetshop } = useSettings();
//   const toast = useToast();
//   const [isSaving, setIsSaving] = useState(false);

//   const [formData, setFormData] = useState<
//     Record<string, { open: string; close: string }>
//   >({});
//   const [defaultCapacity, setDefaultCapacity] = useState(3);

//   useEffect(() => {
//     if (petshop) {
//       setFormData(parseBusinessHours(petshop.businessHours));
//       setDefaultCapacity(petshop.defaultCapacityPerHour || 3);
//     }
//   }, [petshop]);

//   const handleBusinessHoursChange = useCallback(
//     (day: string, field: "open" | "close", value: string) => {
//       setFormData((prev) => ({
//         ...prev,
//         [day]: {
//           ...((prev?.[day] as any) || { open: "", close: "" }),
//           [field]: value,
//         },
//       }));
//     },
//     [],
//   );

//   const handleRemoveDay = useCallback((day: string) => {
//     setFormData((prev) => {
//       const newData = { ...prev };
//       delete newData[day];
//       return newData;
//     });
//   }, []);

//   const handleSave = useCallback(async () => {
//     setIsSaving(true);
//     try {
//       // Convert { open, close } format to "HH:MM-HH:MM" string format for API
//       const formattedHours: Record<string, string> = {};
//       for (const [day, hours] of Object.entries(formData)) {
//         if (hours.open && hours.close) {
//           formattedHours[day] = `${hours.open}-${hours.close}`;
//         }
//       }

//       await updatePetshop({
//         business_hours: formattedHours,
//         default_capacity_per_hour: defaultCapacity,
//       });
//       toast.success("Salvo!", "Horários foram atualizados com sucesso.");
//     } catch (error) {
//       console.error("Erro ao salvar:", error);
//       toast.error("Erro", "Não foi possível salvar os horários.");
//     } finally {
//       setIsSaving(false);
//     }
//   }, [formData, defaultCapacity, updatePetshop, toast]);

//   if (loadingPetshop) {
//     return (
//       <div className="flex items-center justify-center py-12">
//         <Loader2 className="h-8 w-8 animate-spin text-[#1E62EC]" />
//       </div>
//     );
//   }

//   return (
//     <div className="space-y-6">
//       {/* Capacidade Padrão */}
//       <div className="rounded-lg border border-[#727B8E]/10 bg-white p-6 dark:border-[#40485A] dark:bg-[#1A1B1D]">
//         <h3 className="mb-4 text-lg font-semibold text-[#434A57] dark:text-[#f5f9fc]">
//           Configurações Gerais
//         </h3>

//         <div className="max-w-xs">
//           <label className="mb-2 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
//             Capacidade Padrão (por hora)
//           </label>
//           <Input
//             type="number"
//             value={defaultCapacity}
//             onChange={(e) => setDefaultCapacity(parseInt(e.target.value) || 1)}
//             min="1"
//             max="20"
//           />
//           <p className="mt-2 text-xs text-[#727B8E] dark:text-[#8a94a6]">
//             Quantidade máxima de agendamentos por hora
//           </p>
//         </div>
//       </div>

//       {/* Horários por Dia */}
//       <div className="rounded-lg border border-[#727B8E]/10 bg-white p-6 dark:border-[#40485A] dark:bg-[#1A1B1D]">
//         <h3 className="mb-4 text-lg font-semibold text-[#434A57] dark:text-[#f5f9fc]">
//           Horários de Funcionamento
//         </h3>

//         <div className="space-y-4">
//           {WEEKDAYS.map((day) => {
//             const hours = formData?.[day.value];
//             const isOpen = !!hours && (!!hours.open || !!hours.close);

//             return (
//               <div
//                 key={day.value}
//                 className="rounded-lg border border-[#727B8E]/10 p-4 dark:border-[#40485A]"
//               >
//                 <div className="flex items-center justify-between">
//                   <div className="flex-1">
//                     <h4 className="font-medium text-[#434A57] dark:text-[#f5f9fc]">
//                       {day.label}
//                     </h4>

//                     {isOpen && hours ? (
//                       <div className="mt-3 grid grid-cols-2 gap-3">
//                         <div>
//                           <label className="mb-1 block text-xs text-[#727B8E] dark:text-[#8a94a6]">
//                             Abertura
//                           </label>
//                           <Input
//                             type="time"
//                             value={hours.open || ""}
//                             onChange={(e) =>
//                               handleBusinessHoursChange(
//                                 day.value,
//                                 "open",
//                                 e.target.value,
//                               )
//                             }
//                             className="text-sm"
//                           />
//                         </div>
//                         <div>
//                           <label className="mb-1 block text-xs text-[#727B8E] dark:text-[#8a94a6]">
//                             Fechamento
//                           </label>
//                           <Input
//                             type="time"
//                             value={hours.close || ""}
//                             onChange={(e) =>
//                               handleBusinessHoursChange(
//                                 day.value,
//                                 "close",
//                                 e.target.value,
//                               )
//                             }
//                             className="text-sm"
//                           />
//                         </div>
//                       </div>
//                     ) : (
//                       <p className="mt-2 text-sm text-[#727B8E] dark:text-[#8a94a6]">
//                         Fechado
//                       </p>
//                     )}
//                   </div>

//                   <div className="ml-4 flex flex-col gap-2">
//                     {isOpen ? (
//                       <Button
//                         size="sm"
//                         variant="outline"
//                         onClick={() => handleRemoveDay(day.value)}
//                       >
//                         Fechar
//                       </Button>
//                     ) : (
//                       <Button
//                         size="sm"
//                         onClick={() =>
//                           handleBusinessHoursChange(day.value, "open", "09:00")
//                         }
//                       >
//                         <Clock className="mr-2 h-4 w-4" />
//                         Abrir
//                       </Button>
//                     )}
//                   </div>
//                 </div>
//               </div>
//             );
//           })}
//         </div>
//       </div>

//       <Button onClick={handleSave} disabled={isSaving} className="flex gap-2">
//         {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
//         {isSaving ? "Salvando..." : "Salvar Horários"}
//       </Button>
//     </div>
//   );
// }
