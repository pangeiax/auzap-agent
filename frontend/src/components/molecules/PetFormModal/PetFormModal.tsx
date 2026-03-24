import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Modal } from '@/components/molecules/Modal'
import { FormField } from '@/components/molecules/FormField'
import { Select } from '@/components/atoms/Select'
import { TextArea } from '@/components/atoms/TextArea'
import { Input } from '@/components/atoms/Input'
import { maskDate, dateToISO, dateFromISO } from '@/lib/masks'
import { PET_SIZE_OPTIONS_WITH_PLACEHOLDER, normalizePetSize } from '@/lib/petSize'
import type { Pet } from '@/types'
import type { PetCreate, PetUpdate } from '@/services/petService'

export interface PetFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: PetCreate | PetUpdate) => Promise<void>
  pet?: Pet | null
  clientId: string
  petshopId: number
}

interface PetFormData {
  name: string
  species: string
  breed: string
  age: string
  size: string
  weight: string
  color: string
  medical_info: string
  vaccination_date: string
  last_vet_visit: string
  emergency_contact: string
}

const speciesOptions = [
  { value: '', label: 'Selecione a espécie' },
  { value: 'cachorro', label: 'Cachorro' },
  { value: 'gato', label: 'Gato' },
  { value: 'ave', label: 'Ave' },
  { value: 'roedor', label: 'Roedor' },
  { value: 'reptil', label: 'Réptil' },
  { value: 'peixe', label: 'Peixe' },
  { value: 'outro', label: 'Outro' },
]

const sizeOptions = [...PET_SIZE_OPTIONS_WITH_PLACEHOLDER]

export function PetFormModal({
  isOpen,
  onClose,
  onSubmit,
  pet,
  clientId,
  petshopId,
}: PetFormModalProps) {
  const [isLoading, setIsLoading] = useState(false)
  const isEditing = !!pet

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PetFormData>({
    defaultValues: {
      name: '',
      species: '',
      breed: '',
      age: '',
      size: '',
      weight: '',
      color: '',
      medical_info: '',
      vaccination_date: '',
      last_vet_visit: '',
      emergency_contact: '',
    },
  })

  useEffect(() => {
    if (pet) {
      reset({
        name: pet.name || '',
        species: pet.species || '',
        breed: pet.breed || '',
        age: pet.age?.toString() || '',
        size: normalizePetSize(pet.size) ?? '',
        weight: pet.weight?.toString() || '',
        color: pet.color || '',
        medical_info: (typeof pet.medical_info === 'string' ? pet.medical_info : '') || '',
        vaccination_date: pet.vaccination_date ? dateFromISO(pet.vaccination_date.split('T')[0]) : '',
        last_vet_visit: pet.last_vet_visit ? dateFromISO(pet.last_vet_visit.split('T')[0]) : '',
        emergency_contact: pet.emergency_contact || '',
      })
    } else {
      reset({
        name: '',
        species: '',
        breed: '',
        age: '',
        size: '',
        weight: '',
        color: '',
        medical_info: '',
        vaccination_date: '',
        last_vet_visit: '',
        emergency_contact: '',
      })
    }
  }, [pet, reset, isOpen])

  const handleFormSubmit = async (data: PetFormData) => {
    setIsLoading(true)
    try {
      
      const vaccinationISO = data.vaccination_date ? dateToISO(data.vaccination_date) : undefined
      const lastVetISO = data.last_vet_visit ? dateToISO(data.last_vet_visit) : undefined

      const payload: PetCreate | PetUpdate = {
        ...(isEditing ? {} : { petshop_id: petshopId, client_id: clientId }),
        name: data.name,
        species: data.species || undefined,
        breed: data.breed || undefined,
        age: data.age ? parseInt(data.age) : undefined,
        size: data.size || undefined,
        weight: data.weight ? parseFloat(data.weight) : undefined,
        color: data.color || undefined,
        medical_info: data.medical_info ? { conditions: [data.medical_info] } : undefined,
        vaccination_date: vaccinationISO || undefined,
        last_vet_visit: lastVetISO || undefined,
        emergency_contact: data.emergency_contact || undefined,
      }

      await onSubmit(payload)
      onClose()
    } catch (error) {
      console.error('Erro ao salvar pet:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Editar Pet' : 'Cadastrar Pet'}
      onSubmit={handleSubmit(handleFormSubmit)}
      submitText={isEditing ? 'Salvar' : 'Cadastrar'}
      isLoading={isLoading}
      className="sm:max-w-lg"
    >
      <div className="flex flex-col gap-4">
        <FormField
          id="name"
          label="Nome do Pet"
          required
          placeholder="Ex: Rex, Luna, Mel..."
          error={errors.name?.message}
          {...register('name', { required: 'Nome é obrigatório' })}
        />

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[#434A57] dark:text-[#c5cdd9]">
              Espécie <span className="text-red-500">*</span>
            </label>
            <Select
              options={speciesOptions}
              {...register('species', { required: 'Espécie é obrigatória' })}
            />
            {errors.species && (
              <p className="text-xs text-red-500">{errors.species.message}</p>
            )}
          </div>

          <FormField
            id="breed"
            label="Raça"
            placeholder="Ex: Labrador, Sem raça definida..."
            {...register('breed')}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <FormField
            id="age"
            label="Idade"
            type="number"
            placeholder="Anos"
            {...register('age')}
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[#434A57] dark:text-[#c5cdd9]">
              Porte <span className="text-red-500">*</span>
            </label>
            <Select
              options={sizeOptions}
              {...register('size', { required: 'Porte é obrigatório' })}
            />
            {errors.size && (
              <p className="text-xs text-red-500">{errors.size.message}</p>
            )}
          </div>

          <FormField
            id="weight"
            label="Peso (kg)"
            type="number"
            step="0.1"
            placeholder="Ex: 5.5"
            {...register('weight')}
          />
        </div>

        <FormField
          id="color"
          label="Cor/Pelagem"
          placeholder="Ex: Caramelo, Preto e branco..."
          {...register('color')}
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[#434A57] dark:text-[#c5cdd9]">
            Informações Médicas
          </label>
          <TextArea
            placeholder="Alergias, medicações, condições especiais..."
            rows={3}
            {...register('medical_info')}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            id="vaccination_date"
            label="Última Vacinação"
            placeholder="DD/MM/AAAA"
            maxLength={10}
            {...register('vaccination_date', {
              onChange: (e) => {
                e.target.value = maskDate(e.target.value)
              }
            })}
          />

          <FormField
            id="last_vet_visit"
            label="Última Consulta"
            placeholder="DD/MM/AAAA"
            maxLength={10}
            {...register('last_vet_visit', {
              onChange: (e) => {
                e.target.value = maskDate(e.target.value)
              }
            })}
          />
        </div>

        <FormField
          id="emergency_contact"
          label="Contato de Emergência"
          placeholder="(00) 00000-0000"
          {...register('emergency_contact')}
        />
      </div>
    </Modal>
  )
}
