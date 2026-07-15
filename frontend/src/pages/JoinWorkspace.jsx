/* Copyright 2017-present, The Visdom Authors */
import React, { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../context/AuthContext';

const JoinWorkspace = () => {
  const { linkId } = useParams();
  const navigate = useNavigate();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const join = async (password) => {
      try {
        const response = await api.post(`/workspaces/share/${linkId}/join`, { password: password || null });
        const { workspace, role, status } = response.data;
        if (status === 'active') {
          window.alert(`You're already a member of "${workspace.name}".`);
        } else {
          window.alert(
            `Your request to join "${workspace.name}" as ${role} has been sent. ` +
              "An admin needs to approve it before it shows up in your workspaces."
          );
        }
        navigate('/', { replace: true });
      } catch (err) {
        const detail = err.response?.data?.detail;

        if (err.response?.status === 401 && detail === 'This shared link requires a password.') {
          const password = window.prompt('This shared link is password protected. Enter the password:');
          if (password) {
            join(password);
          } else {
            navigate('/', { replace: true });
          }
          return;
        }

        window.alert(typeof detail === 'string' ? detail : 'This shared link is invalid.');
        navigate('/', { replace: true });
      }
    };

    const wantsToJoin = window.confirm(
      "You've been invited to join a workspace via a shared link. Request to join now? " +
        "An admin will need to approve your request before you get access."
    );
    if (wantsToJoin) {
      join(null);
    } else {
      navigate('/', { replace: true });
    }
  }, [linkId, navigate]);

  return (
    <div className="auth-wrapper">
      <div className="visdom-panel auth-panel gc-text-center">
        Processing invitation...
      </div>
    </div>
  );
};

export default JoinWorkspace;
