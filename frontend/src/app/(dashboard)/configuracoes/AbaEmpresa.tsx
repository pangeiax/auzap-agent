// import React, { useState, useCallback, useEffect } from "react";
// import { Loader2 } from "lucide-react";
// import { Button } from "@/components/atoms/Button";
// import { Input } from "@/components/atoms/Input";
// import { TextArea } from "@/components/atoms/TextArea";
// import { useSettings } from "@/hooks/useSettings";
// import { useToast } from "@/hooks";

// type FormField =
//   | "companyName"
//   | "assistantName"
//   | "phone"
//   | "ownerPhone"
//   | "address"
//   | "cep"
//   | "emergencyContact";

// export function AbaEmpresa() {
//   const { petshop, loadingPetshop, petshopError, updatePetshop } =
//     useSettings();
//   const toast = useToast();
//   const [isSaving, setIsSaving] = useState(false);

//   const [formData, setFormData] = useState({
//     companyName: "",
//     assistantName: "",
//     phone: "",
//     ownerPhone: "",
//     address: "",
//     cep: "",
//     emergencyContact: "",
//   });

//   useEffect(() => {
//     if (petshop) {
//       setFormData({
//         companyName: petshop.company?.name || "",
//         assistantName: petshop.assistantName || "",
//         phone: petshop.phone || "",
//         ownerPhone: petshop.ownerPhone || "",
//         address: petshop.address || "",
//         cep: petshop.cep || "",
//         emergencyContact: petshop.emergencyContact || "",
//       });
//     }
//   }, [petshop]);

//   const handleChange = useCallback((field: FormField, value: string) => {
//     setFormData((prev) => ({ ...prev, [field]: value }));
//   }, []);

//   const handleSave = useCallback(async () => {
//     setIsSaving(true);
//     try {
//       await updatePetshop({
//         assistant_name: formData.assistantName,
//         phone: formData.phone,
//         owner_phone: formData.ownerPhone,
//         address: formData.address,
//         cep: formData.cep,
//         emergency_contact: formData.emergencyContact,
//       });
//       toast.success(
//         "Configuração salva!",
//         "Os dados foram atualizados com sucesso.",
//       );
//     } catch (error) {
//       console.error("Erro ao salvar:", error);
//       toast.error("Erro", "Não foi possível salvar as configurações.");
//     } finally {
//       setIsSaving(false);
//     }
//   }, [formData, updatePetshop, toast]);

//   if (loadingPetshop) {
//     return (
//       <div className="flex items-center justify-center py-12">
//         <Loader2 className="h-8 w-8 animate-spin text-[#1E62EC]" />
//       </div>
//     );
//   }

//   if (petshopError) {
//     return (
//       <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
//         <p className="text-sm text-red-800 dark:text-red-400">{petshopError}</p>
//       </div>
//     );
//   }

//   return (
//     <div className="space-y-6">
//       <div className="rounded-lg border border-[#727B8E]/10 bg-white p-6 dark:border-[#40485A] dark:bg-[#1A1B1D]">
//         <h3 className="mb-4 text-lg font-semibold text-[#434A57] dark:text-[#f5f9fc]">
//           Informações da Empresa
//         </h3>

//         <div className="space-y-4">
//           <div>
//             <label className="mb-2 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
//               Nome da Empresa
//             </label>
//             <Input
//               value={formData.companyName}
//               disabled
//               placeholder="Nome da empresa"
//               className="bg-gray-100 dark:bg-[#2a2b2d]"
//             />
//             <p className="mt-1 text-xs text-[#727B8E] dark:text-[#8a94a6]">
//               Este campo não é editável aqui. Altere nas configurações da
//               empresa.
//             </p>
//           </div>

//           <div>
//             <label className="mb-2 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
//               Nome da IA/Assistente
//             </label>
//             <Input
//               value={formData.assistantName}
//               onChange={(e) => handleChange("assistantName", e.target.value)}
//               placeholder="Ex: Bigo, Pepe, etc."
//             />
//           </div>

//           <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
//             <div>
//               <label className="mb-2 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
//                 Telefone do Estabelecimento
//               </label>
//               <Input
//                 value={formData.phone}
//                 onChange={(e) => handleChange("phone", e.target.value)}
//                 placeholder="(11) 99999-0000"
//               />
//             </div>

//             <div>
//               <label className="mb-2 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
//                 Telefone do Proprietário
//               </label>
//               <Input
//                 value={formData.ownerPhone}
//                 onChange={(e) => handleChange("ownerPhone", e.target.value)}
//                 placeholder="(11) 99999-0000"
//               />
//             </div>
//           </div>

//           <div>
//             <label className="mb-2 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
//               Endereço
//             </label>
//             <TextArea
//               value={formData.address}
//               onChange={(e) => handleChange("address", e.target.value)}
//               placeholder="Rua das Flores, 123 - São Paulo, SP"
//               rows={3}
//             />
//           </div>

//           <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
//             <div>
//               <label className="mb-2 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
//                 CEP
//               </label>
//               <Input
//                 value={formData.cep}
//                 onChange={(e) => handleChange("cep", e.target.value)}
//                 placeholder="01310-100"
//               />
//             </div>

//             <div>
//               <label className="mb-2 block text-sm font-medium text-[#434A57] dark:text-[#f5f9fc]">
//                 Contato de Emergência
//               </label>
//               <Input
//                 value={formData.emergencyContact}
//                 onChange={(e) =>
//                   handleChange("emergencyContact", e.target.value)
//                 }
//                 placeholder="(11) 99999-0000"
//               />
//             </div>
//           </div>
//         </div>

//         <Button
//           onClick={handleSave}
//           disabled={isSaving}
//           className="mt-6 flex gap-2"
//         >
//           {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
//           {isSaving ? "Salvando..." : "Salvar Alterações"}
//         </Button>
//       </div>
//     </div>
//   );
// }
