export default function LoggedInWarning() {
  return (
    <div className="flex items-center justify-center">
      <div className="w-60 pt-6 pb-4 px-4 rounded-2xl flex flex-col">
        <p className="text-center text-(--text) mb-6 text-[14px]">View notification messages after logging in</p>
        <div className="w-52 text-center text-(--text-stron) bg-[#ff2c55] rounded-[10px] text-[14px] leading-9">Login now</div>
      </div>
    </div>
  );
}
