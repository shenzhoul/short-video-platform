'use client';
import Button from '@components/ui/button';
import { useRouter } from 'next/navigation';
import { FiArrowLeft } from 'react-icons/fi';

interface IProps {
  className?: string
}
export default function BackButton({ className }: IProps) {
  const router = useRouter();
  return (
    <Button variant="grey-light" className={className} onClick={() => router.back()}><FiArrowLeft /></Button>
  );
}
