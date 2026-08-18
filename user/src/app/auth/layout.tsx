import Logo from '@components/layout/logo';
import BackButton from '@components/ui/backButton';
import React from 'react';
export default async function AuthLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex overflow-hidden w-full min-h-screen">
        <div className='md:w-[40%] relative max-lg:hidden'>
          <div className="absolute top-0 left-0 w-full p-5 flex justify-center">
            <Logo height='h-10' white />
          </div>
          <div className='absolute bottom-0 left-0 w-full px-10 pb-10 min-h-1/3 flex flex-col items-center justify-end text-center text-2xl text-white bg-linear-to-b from-black/0 to-black/80 bold'>
            Sign up to connect with creators around the world—each with their own unique stories and talents.
          </div>
        </div>
        <div className="w-full lg:w-[60%] relative overflow-auto lg:h-dvh max-lg:pt-18">
          <div className="absolute top-2 left-2 z-10">
            <BackButton className='p-0! w-10 h-10' />
          </div>
          <div className="absolute top-0 left-0 w-full p-5 flex justify-center lg:hidden">
            <Logo height='h-7' />
          </div>
          <div className='flex-1 flex flex-col justify-center items-center w-full p-8 max-lg:p-4 min-h-[calc(100dvh-100px)]'>{children}</div>
        </div>
      </div>
    </div>
  );
}
