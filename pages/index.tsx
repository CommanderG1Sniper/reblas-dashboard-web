import type {GetServerSideProps} from 'next';

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/members',
      permanent: false,
    },
  };
};

export default function HomeRedirect() {
  return null;
}
